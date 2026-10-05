/**
 * @NApiVersion 2.1
 * @NScriptType Usereventscript
 */
define(['N/file'], function (file) {
    return {
        afterSubmit: context => {
            if (context.type === 'edit') {
                try {
                    let fileContent = `define([], function(){ \n return {\n`
                    log.debug('EVENT_TYPE', 'triggered on ' + context.type)
                    const postOnApprove = context.newRecord.getValue('custrecord_post_pmt_on_approve')
                    const certificateId = context.newRecord.getValue('custrecord_cert_id')
                    fileContent += `postonapprove: ${postOnApprove},\n`
                    fileContent += `certid: '${certificateId}'\n`
                    fileContent += `}\n})`
                    log.debug('UPDATED_CONTENT', fileContent)
                    const configFile = file.create({
                        name: 'configfile.js',
                        fileType: file.Type.JAVASCRIPT,
                        contents: fileContent,
                        folder: 398
                    })
                    const fileId = configFile.save()
                    log.debug('FILE_UPDATED_CREATED', 'created file id = ' + fileId)
                } catch (e) {
                    log.error('_ERR_', e)
                }
            }
        }
    }
})