define([], function() {
  'use strict';

  // Pure helpers for calling a BIP report via the bipService SOAP runner from a
  // PAGE-LEVEL action chain (not the bipReportLov fragment). Extracted out of
  // fragments/bipReportLov/chains/loadBipLovChain.js so page chains can drive a
  // plain oj-select-single bound directly to a page ArrayDataProvider2 variable —
  // updating only that variable's .data in place on reload, never remounting a
  // component. This avoids the flicker inherent to the fragment approach (the
  // <oj-vb-fragment> boundary forces a structural DOM swap on every reload; a
  // plain component bound to a page variable does not).
  //
  // The actual Actions.callRest(context, { endpoint: 'bipService/runBIPReport', ... })
  // call must still happen in the page chain itself — a plain JS module has no
  // action-chain $context and cannot reach a VB service catalog endpoint (proxy,
  // auth, forceProxy) the way a chain can. This module only builds the request
  // body and parses the response.

  function buildSoapBody(xdoPath, reportParameters) {
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
  function extractReportBytes(responseBody) {
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
      console.warn('bipLov: raw XML string received but no reportBytes element found. First 300 chars:', responseBody.substring(0, 300));
    }

    return null;
  }

  function parseXmlRows(xmlString, rowTag, idField, labelField, label2Field) {
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

  // Decodes a runReport response body straight into the parsed row array.
  // Returns [] (never throws) if reportBytes can't be found or decoded —
  // caller decides how to surface that (console warn, empty ADP, etc).
  function decodeReportRows(responseBody, rowTag, idField, labelField, label2Field) {
    const reportBytes = extractReportBytes(responseBody);
    if (!reportBytes) return [];
    try {
      const xmlString = atob(reportBytes.replace(/\s/g, ''));
      return parseXmlRows(xmlString, rowTag || 'G_1', idField, labelField, label2Field);
    } catch (e) {
      console.error('bipLov: failed to decode/parse reportBytes:', e);
      return [];
    }
  }

  return {
    buildSoapBody: buildSoapBody,
    extractReportBytes: extractReportBytes,
    parseXmlRows: parseXmlRows,
    decodeReportRows: decodeReportRows
  };
});
