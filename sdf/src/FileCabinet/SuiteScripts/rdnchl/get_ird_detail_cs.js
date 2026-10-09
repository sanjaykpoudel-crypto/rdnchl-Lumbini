define(['N/url', 'N/currentRecord', 'N/record', 'N/ui/dialog'], function (url, currentRecord, record, dialog) {
    return {
        getirdpaymentdetail: function () {
            const billRecord = currentRecord.get()
            const bankAccountId = billRecord.getValue('custpage_nchl_bank_ac')
            const docOffice = billRecord.getValue('custpage_doc_office')
            if (bankAccountId && docOffice) {
                const accountRecord = record.load({
                    type: record.Type.ACCOUNT,
                    id: bankAccountId
                })
                const bankDetailRecord = record.load({
                    type: 'customrecord_rd_nchl_bank_detail',
                    id: accountRecord.getValue('custrecord_rdnchl_coa_bank_detail')
                })
                const reqParam = {
                    bankProp: bankDetailRecord.getValue('custrecord_rdnchl_bank_prop'),
                    bankBranchProp: bankDetailRecord.getValue('custrecord_rdnchl_bank_branch_prop'),
                    accountName: bankDetailRecord.getValue('custrecord_rdnchl_account_name'),
                    accountNumber: bankDetailRecord.getValue('custrecord_rdnchl_account_number'),
                    entityId: billRecord.getValue('entity'),
                    recmemo: billRecord.getValue('memo'),
                    appid: docOffice
                }
                var leftPosition, topPosition;
                leftPosition = (window.screen.width / 2) - ((1000 / 2) + 10);
                topPosition = (window.screen.height / 2) - ((1000 / 2) + 50);
                //Define the window
                var params = 'height=' + 1000 + ' , width=' + 1000;
                params += ' , left=' + leftPosition + ", top=" + topPosition;
                params += ' ,screenX=' + leftPosition + ' ,screenY=' + topPosition;
                params += ', status=no';
                params += ' ,toolbar=no';
                params += ' ,menubar=no';
                params += ', resizable=yes';
                params += ' ,scrollbars=no';
                params += ' ,location=no';
                params += ' ,directories=no'
                var suiteletURL = url.resolveScript({
                    scriptId: 'customscript_get_npi_doc_detail',
                    deploymentId: 'customdeploy_get_npi_doc_detail',
                    params: reqParam
                })
                window.open(suiteletURL, "New Window Title", params);
            } else {
                var title
                if (!bankAccountId && !docOffice) {
                    title = 'Bank Account and DOC Office'
                } else if (!bankAccountId && docOffice) {
                    title = 'Bank Account'
                } else if (bankAccountId && !docOffice) {
                    title = 'DOC Office'
                }
                dialog.alert({
                    title: title + ' Required for DOC Detail',
                    message: 'Please select ' + title + ' for DOC detail'
                })
            }
        }
    }
})