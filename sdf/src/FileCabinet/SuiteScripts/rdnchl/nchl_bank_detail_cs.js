/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
// NCHL bank detail form: bank and branch lists from NCHL, the account check as soon as bank, account number and
// name are filled in (it also selects the account's branch), and a progress overlay while NCHL answers
define(['./rdmoduleclient', 'N/ui/message'], function (rdmodc, message) {
    const ACCOUNT_FIELDS = ['custpage_nchl_bank', 'custrecord_rdnchl_account_number', 'custrecord_rdnchl_account_name']
    let banner = null
    // only the latest account check may update the form
    let checkSeq = 0

    function showbanner(type, title, text, duration) {
        if (banner) {
            banner.hide()
        }
        banner = message.create({type: type, title: title, message: text})
        banner.show(duration ? {duration: duration} : undefined)
    }

    /**
     * Covers the page while NCHL answers so the form is not saved or changed twice
     * @param {string|null} text null removes the overlay
     */
    function setbusy(text) {
        let overlay = document.getElementById('lc_nchl_busy')
        if (!text) {
            if (overlay) {
                overlay.parentNode.removeChild(overlay)
            }
            return
        }
        if (!document.getElementById('lc_nchl_busy_style')) {
            const style = document.createElement('style')
            style.id = 'lc_nchl_busy_style'
            style.textContent = '@keyframes lcNchlSpin{to{transform:rotate(360deg)}}'
            document.head.appendChild(style)
        }
        if (!overlay) {
            overlay = document.createElement('div')
            overlay.id = 'lc_nchl_busy'
            overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:100000;' +
                'background:rgba(255,255,255,0.65);display:flex;align-items:center;justify-content:center'
            document.body.appendChild(overlay)
        }
        overlay.innerHTML = '<div style="background:#fff;border:1px solid #d0d7de;border-radius:6px;padding:16px 24px;' +
            'box-shadow:0 4px 16px rgba(0,0,0,0.15);font:14px Arial,sans-serif;display:flex;align-items:center;gap:12px">' +
            '<span style="width:18px;height:18px;border:3px solid #d0d7de;border-top-color:#2f6fb7;border-radius:50%;' +
            'display:inline-block;animation:lcNchlSpin 0.8s linear infinite"></span><span></span></div>'
        overlay.querySelector('span:last-child').textContent = text
    }

    function setbranch(rec, branchId, branchName) {
        const field = rec.getField({fieldId: 'custpage_nchl_bank_branch'})
        // the option list is NCHL's branch list for the bank; add the branch if it is not in it
        if (!field.getSelectOptions().some(option => String(option.value) === String(branchId))) {
            field.insertSelectOption({value: branchId, text: branchName || branchId})
        }
        rec.setValue({fieldId: 'custpage_nchl_bank_branch', value: branchId, ignoreFieldChange: true})
        rec.setValue({
            fieldId: 'custrecord_rdnchl_bank_branch_prop',
            value: JSON.stringify({value: branchId, text: branchName || rec.getText('custpage_nchl_bank_branch')}),
            ignoreFieldChange: true
        })
    }

    /**
     * Asks NCHL whether the account exists under that name, selects its branch and marks it verified on a full match
     * @returns {Promise<Object|null>} NCHL's answer, or null when details are missing, a newer check started or it failed
     */
    function checkaccount(rec) {
        const bankId = rec.getValue('custpage_nchl_bank')
        const accountNumber = rec.getValue('custrecord_rdnchl_account_number')
        const accountName = rec.getValue('custrecord_rdnchl_account_name')
        if (!bankId || !accountNumber || !accountName) {
            return Promise.resolve(null)
        }
        const seq = ++checkSeq
        showbanner(message.Type.INFORMATION, 'Checking account with NCHL...', `${accountNumber} at ${rec.getText('custpage_nchl_bank')}`)
        return rdmodc.verifyaccount({bankId: bankId, accountNumber: accountNumber, accountName: accountName}).then(result => {
            if (seq !== checkSeq) {
                return null
            }
            if (result.branchId) {
                setbranch(rec, result.branchId, result.branchName)
            }
            if (result.verified) {
                // set last: changing any other field clears the verified flag
                rec.setValue({fieldId: 'custrecord_nchl_account_verified', value: true, ignoreFieldChange: true})
                showbanner(message.Type.CONFIRMATION, 'Account verified by NCHL',
                    `${result.accountName || accountName}, ${result.branchName || 'branch ' + result.branchId} branch`, 10000)
            } else {
                showbanner(result.matchPercentage > 80 ? message.Type.WARNING : message.Type.ERROR,
                    result.matchPercentage > 80 ? 'Account name differs' : 'Account not verified',
                    `${result.responseMessage || ''} (name match ${result.matchPercentage || 0}%)`)
            }
            return result
        }).catch(e => {
            if (seq === checkSeq) {
                showbanner(message.Type.ERROR, 'NCHL account check failed', e.message)
            }
            return null
        })
    }

    function clickSave() {
        const saveButton = document.getElementById('btn_multibutton_submitter') || document.getElementById('submitter')
        if (saveButton) {
            saveButton.click()
        }
    }

    return {
        fieldChanged: function (context) {
            const rec = context.currentRecord
            const isVerified = rec.getValue('custrecord_nchl_account_verified')
            const triggerEvents = rec.getValue('custpage_trigger_events')
            if (context.fieldId !== 'custrecord_nchl_account_verified' && isVerified && triggerEvents) {
                rec.setValue({fieldId: 'custrecord_nchl_account_verified', value: false})
            }
            if (context.fieldId === 'custpage_nchl_bank_type') {
                const bankType = rec.getValue(context.fieldId)
                rec.setValue({fieldId: 'custrecord_nchl_bank_type', value: bankType})
                const bankListField = rec.getField({fieldId: 'custpage_nchl_bank'})
                bankListField.removeSelectOption({value: null})
                if (bankType) {
                    bankListField.insertSelectOption({value: '', text: ''})
                    rdmodc.getbanklist({type: bankType}).forEach(bank => {
                        bankListField.insertSelectOption({value: bank.bankId, text: bank.bankName})
                    })
                }
            } else if (context.fieldId === 'custpage_nchl_bank') {
                const bankId = rec.getValue(context.fieldId)
                rec.setValue({
                    fieldId: 'custrecord_rdnchl_bank_prop',
                    value: JSON.stringify({value: bankId, text: rec.getText(context.fieldId)})
                })
                const bankBranchField = rec.getField({fieldId: 'custpage_nchl_bank_branch'})
                bankBranchField.removeSelectOption({value: null})
                if (bankId) {
                    bankBranchField.insertSelectOption({value: '', text: ''})
                    rdmodc.getbankbranchlist({bankId: bankId}).forEach(branch => {
                        bankBranchField.insertSelectOption({value: branch.branchId, text: branch.branchName})
                    })
                }
            } else if (context.fieldId === 'custpage_nchl_bank_branch') {
                rec.setValue({
                    fieldId: 'custrecord_rdnchl_bank_branch_prop',
                    value: JSON.stringify({value: rec.getValue(context.fieldId), text: rec.getText(context.fieldId)})
                })
            }
            if (ACCOUNT_FIELDS.includes(context.fieldId)) {
                checkaccount(rec)
            }
        },
        saveRecord: function (context) {
            const rec = context.currentRecord
            if (rec.getValue('custrecord_nchl_account_verified')) {
                // the server asks NCHL once more before saving, which takes a few seconds
                setbusy('Saving... NCHL is confirming the account')
                return true
            }
            if (!rec.getValue('custpage_nchl_bank') || !rec.getValue('custrecord_rdnchl_account_number') ||
                !rec.getValue('custrecord_rdnchl_account_name')) {
                showbanner(message.Type.ERROR, 'Missing details', 'Choose the bank and enter the account number and account name.')
                return false
            }
            // check first, then save again once NCHL has verified the account
            setbusy('Checking account with NCHL...')
            checkaccount(rec).then(result => {
                setbusy(null)
                if (result && result.verified) {
                    clickSave()
                }
            })
            return false
        }
    }
})
