define(['./rdmoduleclient', 'N/ui/dialog'], function (rdmodc, dialog) {
    return {
        gettranstatus: function (option) {
            const fnOpt = JSON.parse(option)
            console.log(fnOpt)
            //const api = fnOpt.isrealtime ? '/api/getcipstxnbyinstructionid' : '/api/getnchlipstxnlistbybatchid'
            const api = fnOpt.isrealtime ? '/api/getcipstxnlistbybatchid' : '/api/getnchlipstxnlistbybatchid'
            const response = rdmodc.checktranstatus({
                api: api,
                requestBody: {
                    batchId: fnOpt.batchid,
                    //instructionId: fnOpt.cips.instruction.instructionId
                }
            })
            const respBody = JSON.parse(response.body)
            console.log(respBody)
            dialog.alert({
                title: respBody.debitStatus === '000' ? respBody.debitReasonDesc : 'FAILED',
                message: respBody.debitReasonDesc
            })
        },
        reinitiatetran: function (option) {
            console.log(option)
            const fnOpt = JSON.parse(option)
            const api = fnOpt.isrealtime ? '/api/getcipstxnlistbybatchid' : '/api/getnchlipstxnlistbybatchid'
        }
    }
})