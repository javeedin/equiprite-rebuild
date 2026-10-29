define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class loadBipLovChain extends ActionChain {

    buildSoapBody(xdoPath, reportParameters) {
      let paramsXml = '';
      if (reportParameters && reportParameters.length > 0) {
        paramsXml = '<pub:parameterNameValues>';
        reportParameters.forEach((param) => {
          paramsXml +=
            '<pub:item>' +
              '<pub:name>' + param.name + '</pub:name>' +
              '<pub:values>' +
                '<pub:item>' + param.value + '</pub:item>' +
              '</pub:values>' +
            '</pub:item>';
        });
        paramsXml += '</pub:parameterNameValues>';
      }
      return (
        '<soap:Envelope' +
        ' xmlns:soap="http://www.w3.org/2003/05/soap-envelope"' +
        ' xmlns:pub="http://xmlns.oracle.com/oxp/service/PublicReportService">' +
        '<soap:Header/>' +
        '<soap:Body>' +
          '<pub:runReport>' +
            '<pub:reportRequest>' +
              '<pub:attributeFormat>xml</pub:attributeFormat>' +
              '<pub:reportAbsolutePath>' + xdoPath + '</pub:reportAbsolutePath>' +
              paramsXml +
              '<pub:sizeOfDataChunkDownload>-1</pub:sizeOfDataChunkDownload>' +
            '</pub:reportRequest>' +
          '</pub:runReport>' +
        '</soap:Body>' +
        '</soap:Envelope>'
      );
    }

    // Extracts the base64 reportBytes from whatever shape the VBCS proxy returns.
    extractReportBytes(responseBody) {
      if (!responseBody) return null;

      // ── Object (VBCS proxy converted SOAP XML → JSON) ──────────────────────
      if (typeof responseBody === 'object') {
        return (
          responseBody.runReportReturn?.reportBytes ||
          responseBody['ns2:runReportReturn']?.['ns2:reportBytes'] ||
          responseBody['pub:runReportResponse']?.['pub:return']?.['pub:reportBytes'] ||
          responseBody.runReportResponse?.return?.reportBytes ||
          responseBody.return?.reportBytes ||
          responseBody.Body?.runReportResponse?.return?.reportBytes ||
          responseBody.Envelope?.Body?.runReportResponse?.return?.reportBytes ||
          null
        );
      }

      // ── Raw XML string (proxy passed SOAP envelope through unchanged) ───────
      // Use string search instead of DOMParser so namespace prefixes (ns2:, pub:)
      // don't interfere with element lookup.
      if (typeof responseBody === 'string') {
        const candidates = ['reportBytes', 'ns2:reportBytes', 'pub:reportBytes'];
        for (const localName of candidates) {
          const openTag  = '<' + localName + '>';
          const closeTag = '</' + localName + '>';
          const start = responseBody.indexOf(openTag);
          if (start !== -1) {
            const contentStart = start + openTag.length;
            const end = responseBody.indexOf(closeTag, contentStart);
            if (end !== -1) {
              return responseBody.substring(contentStart, end).trim();
            }
          }
        }
        console.warn('bipReportLov: raw XML string received but no reportBytes element found. First 300 chars:', responseBody.substring(0, 300));
      }

      return null;
    }

    parseXmlRows(xmlString, rowTag, idField, labelField, label2Field) {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
      const rows = xmlDoc.querySelectorAll(rowTag);
      return Array.from(rows).map((row) => {
        const item = {};
        Array.from(row.children).forEach((child) => {
          item[child.tagName] = child.textContent;
        });
        item.id     = item[idField]    || '';
        item.label  = item[labelField] || '';
        item.label2 = label2Field ? (item[label2Field] || '') : '';
        return item;
      });
    }

    async run(context) {
      const { $fragment } = context;
      const xdoPath          = $fragment.variables.xdoPath;
      const bipEndpoint      = $fragment.variables.bipEndpoint;
      const idField          = $fragment.variables.idField;
      const labelField       = $fragment.variables.labelField;
      const label2Field      = $fragment.variables.label2Field || '';
      const rowTag           = $fragment.variables.rowTag || 'G_1';
      const reportParameters = $fragment.variables.reportParameters || [];

      if (!xdoPath || !bipEndpoint || !idField || !labelField) {
        console.warn('bipReportLov: skipping — xdoPath, bipEndpoint, idField and labelField are all required');
        return;
      }

      // Skip BIP call if the dropdown is disabled — prevents cascading LOVs
      // from firing on vbEnter before a parent value is selected.
      // onPropertyChangedChain triggers a reload when reportParameters changes.
      if ($fragment.variables.disabled) {
        console.log('bipReportLov: skipping load — disabled, waiting for parent parameter');
        return;
      }

      $fragment.variables.isLoading = true;
      try {
        const soapBody = this.buildSoapBody(xdoPath, reportParameters);

        const response = await Actions.callRest(context, {
          endpoint: bipEndpoint,
          body: soapBody,
        });

        console.log('bipReportLov: response status =', response.status,
          '| body type =', typeof response.body,
          '| preview =', typeof response.body === 'string'
            ? response.body.substring(0, 120)
            : JSON.stringify(response.body).substring(0, 120));

        const reportBytes = this.extractReportBytes(response.body);
        if (!reportBytes) {
          console.error('bipReportLov: could not extract reportBytes.',
            'Full body:', JSON.stringify(response.body).substring(0, 600));
          return;
        }

        // Strip whitespace — some BIP instances insert line breaks into the base64.
        const xmlString = atob(reportBytes.replace(/\s/g, ''));
        const items = this.parseXmlRows(xmlString, rowTag, idField, labelField, label2Field);

        // Update the EXISTING itemsAdp object's .data array in place, rather than
        // replacing the whole itemsAdp object with a new literal. Replacing the object
        // gives oj-select-single a brand-new data-provider reference on every reload
        // (even when the fragment itself stays mounted — e.g. a project change that
        // reloads Contract's reportParameters without a remount), which the component
        // treats as an entirely new data source and briefly blanks/flickers while it
        // resets. Mutating .data on the same object lets ArrayDataProvider2 diff the
        // rows and update the list without tearing down the component's render state.
        const adp = $fragment.variables.itemsAdp;
        if (adp && Array.isArray(adp.data)) {
          adp.data.length = 0;
          adp.data.push(...items);
        } else {
          $fragment.variables.itemsAdp = {
            keyAttributes: 'id',
            itemType: 'BipLovItem',
            data: items,
          };
        }

        console.log('bipReportLov: loaded', items.length, 'items from', xdoPath);
      } catch (e) {
        console.error('bipReportLov loadBipLovChain error:', e);
      } finally {
        $fragment.variables.isLoading = false;
      }
    }
  }

  return loadBipLovChain;
});
