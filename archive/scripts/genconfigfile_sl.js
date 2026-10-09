/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/ui/serverWidget', 'N/file', 'N/record'], function (serverWidget, file, record) {
    return {
        onRequest: context => {
            const form = serverWidget.createForm({
                title: 'Generate Configuration'
            })
            if (context.request.method === 'GET') {
                form.addField({
                    id: 'userid',
                    label: 'userid',
                    type: serverWidget.FieldType.TEXT
                })
                form.addField({
                    id: 'userpassword',
                    label: 'userpassword',
                    type: serverWidget.FieldType.TEXT
                })
                form.addField({
                    id: 'username',
                    label: 'username',
                    type: serverWidget.FieldType.TEXT
                })
                form.addField({
                    id: 'password',
                    label: 'password',
                    type: serverWidget.FieldType.TEXT
                })
                form.addField({
                    id: 'host',
                    label: 'host',
                    type: serverWidget.FieldType.TEXT
                })
                form.addField({
                    id: 'certid',
                    label: 'certificateid',
                    type: serverWidget.FieldType.TEXT
                })
                form.addSubmitButton({label: 'Generate'})
            } else {
                const detialField = form.addField({
                    id: 'result',
                    label: 'details',
                    type: serverWidget.FieldType.LONGTEXT
                })
                try {
                    const params = context.request.parameters
                    const fileContent = `define([], function () {
                return {
                USERID: '${params.userid}',
        USERPASS: '${params.userpassword}',
        USERNAME: '${params.username}',
        PASSWORD: '${params.password}',
        HOST: '${params.host}',
        CERTIFICATE_ID: '${params.certid}'
                }
                })`
                    const folderRecord = record.create({
                        type: record.Type.FOLDER
                    })
                    folderRecord.setValue({
                        fieldId: 'name',
                        value: 'npiconfig'
                    })
                    const folderId = folderRecord.save()
                    const configFile = file.create({
                        name: 'npiconfig.js',
                        fileType: file.Type.JAVASCRIPT,
                        contents: fileContent,
                        folder: folderId
                    })
                    const fileId = configFile.save()
                    const message = `file created with id = ${fileId}`
                    detialField.defaultValue = message
                    log.debug('FILECREATED', message)
                    // detialField.defaultValue = JSON.stringify(params)
                } catch (e) {
                    log.error({
                        title: 'FILE_CREATE_ERROR',
                        details: e
                    })
                    detialField.defaultValue = JSON.stringify(e)
                }
            }
            context.response.writePage({pageObject: form})
        }
    }
})