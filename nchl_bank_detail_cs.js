/**
 * @NApiVersion 2.x
 * @NScriptType ClientScript
 */
define(['./rdmoduleclient', 'N/ui/message'], function (rdmodc, message) {
    return {
        fieldChanged: function (context) {
          console.log(context)
            const isVerified = context.currentRecord.getValue('custrecord_nchl_account_verified')
            const triggerEvents = context.currentRecord.getValue('custpage_trigger_events')
            if (context.fieldId !== 'custrecord_nchl_account_verified' && isVerified && triggerEvents) {
                context.currentRecord.setValue({
                    fieldId: 'custrecord_nchl_account_verified',
                    value: false
                })
            }
            if (context.fieldId === 'custpage_nchl_bank_type') {
                const bankType = context.currentRecord.getValue(context.fieldId)
                context.currentRecord.setValue({
                    fieldId: 'custrecord_nchl_bank_type',
                    value: bankType
                })
                const bankListField = context.currentRecord.getField({fieldId: 'custpage_nchl_bank'})
                bankListField.removeSelectOption({value: null})
                if (bankType) {
                    const banks = rdmodc.getbanklist({type: bankType})
                    bankListField.insertSelectOption({
                        value: '',
                        text: ''
                    })
                    banks.forEach(function (bank) {
                        bankListField.insertSelectOption({
                            value: bank.bankId,
                            text: bank.bankName
                        })
                    })
                }
            } else if (context.fieldId === 'custpage_nchl_bank') {
                const bankId = context.currentRecord.getValue(context.fieldId)
                const bankName = context.currentRecord.getText(context.fieldId)
                context.currentRecord.setValue({
                    fieldId: 'custrecord_rdnchl_bank_prop',
                  //value: bankId
                    value: JSON.stringify({value: bankId, text: bankName})
                })
                const bankBranchField = context.currentRecord.getField({fieldId: 'custpage_nchl_bank_branch'})
                bankBranchField.removeSelectOption({value: null})
                if (bankId) {
                    bankBranchField.insertSelectOption({
                        value: '',
                        text: ''
                    })
                    const bankBranches = rdmodc.getbankbranchlist({bankId: bankId})
                  //console.log(bankBranches)
                    bankBranches.forEach(function (branch) {
                        bankBranchField.insertSelectOption({
                            value: branch.branchId,
                            text: branch.branchName
                        })
                    })
                }
            } else if (context.fieldId === 'custpage_nchl_bank_branch') {
                const branchId = context.currentRecord.getValue(context.fieldId)
                const branchName = context.currentRecord.getText(context.fieldId)
                context.currentRecord.setValue({
                    fieldId: 'custrecord_rdnchl_bank_branch_prop',
                    value: JSON.stringify({
                        value: branchId,
                        text: branchName
                    })
                })
            }
        },
        saveRecord: function (context) {
            const isVerified = context.currentRecord.getValue('custrecord_nchl_account_verified')
            console.log('isverified', isVerified)
            if (isVerified) {
                return true
            } else {
                const verification = rdmodc.verifiaccount({
                    bankId: context.currentRecord.getValue('custpage_nchl_bank'),
                    accountName: context.currentRecord.getValue('custrecord_rdnchl_account_name'),
                    accountNumber: context.currentRecord.getValue('custrecord_rdnchl_account_number'),
                })
                console.log('VERIFICATION_RESPONSE', verification)
                if (verification.matchPercentate === 100) {
                    context.currentRecord.setValue({
                        fieldId: 'custrecord_nchl_account_verified',
                        value: true
                    })
                  context.currentRecord.setValue({
                    fieldId: 'custpage_nchl_bank_branch',
                    value: verification.branchId
                  })
                  /*context.currentRecord.setValue({
                    fieldId: 'custrecord_rdnchl_bank_branch_prop',
                    value: JSON.stringify({
                        value: verification.branchId,
                        text: 'BranchID'
                    })
                })*/
                    return true
                } else {
                    var messageType = message.Type.ERROR
                    var messageTitle = 'Account Mismatch'
                    if (verification.matchPercentate > 80) {
                        messageType = message.Type.WARNING
                        messageTitle = 'Warning'
                    }
                    const messageObj = message.create({
                        type: messageType,
                        title: messageTitle,
                        message: verification.responseMessage,
                        duration: 10000
                    })
                    messageObj.show()
                }
                return false
            }
        }
    }
})