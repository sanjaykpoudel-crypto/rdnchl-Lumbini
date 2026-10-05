define(['N/search', 'N/record'], function (search, record) {
    return {
        getpaymentlist: function () {
            const list = []
            const s =
                search.create({
                    type: "transaction",
                    filters:
                        [
                            ["type", "anyof", "VendPymt", "VPrep"],
                            "AND",
                            ["mainline", "is", "T"],
                            "AND",
                            ["approvalstatus", "anyof", "2"],
                            "AND",
                            ["custbody_rdnchl_bank", "noneof", "@NONE@"]
                        ],
                    columns:
                        [
                            search.createColumn({
                                name: 'trandate',
                                sort: 'DESC'
                            }),
                            "entity",
                            "transactionnumber",
                            "tranid",
                            "amount"
                        ]
                })
            s.run().each(result => {
                list.push({
                    id: result.id,
                    type: result.recordType,
                    tranid: result.getValue('tranid'),
                    entity: result.getText('entity'),
                    trandate: result.getValue('trandate'),
                    amount: result.getValue('amount')
                })
                return true
            })
            return list
        },
        generatebatchdetail: function (option) {
            const tranRecord = record.load({
                type: option.recordtype,
                id: option.recordid
            })
            const object = {}

        }
    }
})