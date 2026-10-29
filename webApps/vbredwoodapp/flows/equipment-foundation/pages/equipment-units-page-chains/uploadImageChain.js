define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Uploads a chosen photo for the current equipment master.
  //
  // Triggered by the oj-file-picker's on-oj-select (onImageSelected), which
  // forwards the picked File as the `file` parameter (see page JSON).
  //
  // The multipart POST goes through Actions.callRest against the registered
  // eqp-v1/uploadEquipmentImage endpoint with contentType 'multipart/form-data'
  // — VB builds the FormData + boundary itself and routes through the service
  // proxy. (A native fetch to the raw backend URL is rewritten by the VB proxy
  // and 404s with "Service eqpt not found", so callRest is the only path that
  // resolves the backend.) The body key `file` must match the multipart part
  // name declared in openapi3.json.
  //
  // On success we update masterRecord.equipmentImage with the returned OCI URL
  // plus a cache-buster (?t=) — the object name is reused ({id}.jpg), so
  // without it the browser would keep showing the old image.
  class uploadImageChain extends ActionChain {
    async run(context, { file }) {
      const { $page } = context;
      const equipmentId = $page.variables.equipmentId;

      if (!file) {
        return; // picker cancelled / no file
      }
      if (!equipmentId) {
        await Actions.fireNotificationEvent(context, {
          summary:     'Upload failed',
          message:     'No equipment is loaded.',
          type:        'error',
          displayMode: 'transient'
        });
        return;
      }

      $page.variables.isUploading = true;
      try {
        const response = await Actions.callRest(context, {
          endpoint:    'eqp-v1/uploadEquipmentImage',
          uriParams:   { id: Number(equipmentId) },
          body:        { file: file },
          contentType: 'multipart/form-data'
        });

        if (!response.ok) {
          // Map the documented backend codes to friendlier messages.
          let message = 'Could not upload the photo.';
          if (response.status === 400) message = 'Bad request — check the file is a JPEG or PNG.';
          else if (response.status === 404) message = 'Equipment record not found.';
          else if (response.status === 502) message = 'Image storage is temporarily unavailable. Please try again later.';
          else if (response.status) message = 'Upload failed (HTTP ' + response.status + ').';
          throw new Error(message);
        }

        const url = response.body && response.body.equipmentImage;
        if (url) {
          // Cache-bust so the freshly-uploaded image replaces the cached one.
          $page.variables.masterRecord = Object.assign({}, $page.variables.masterRecord, {
            equipmentImage: url + (url.indexOf('?') === -1 ? '?' : '&') + 't=' + Date.now()
          });
        }

        await Actions.fireNotificationEvent(context, {
          summary:     'Photo updated',
          message:     'Equipment photo uploaded successfully.',
          type:        'confirmation',
          displayMode: 'transient'
        });
      } catch (e) {
        await Actions.fireNotificationEvent(context, {
          summary:     'Upload failed',
          message:     (e && e.message) ? e.message : 'Could not upload the photo.',
          type:        'error',
          displayMode: 'transient'
        });
      } finally {
        $page.variables.isUploading = false;
      }
    }
  }

  return uploadImageChain;
});
