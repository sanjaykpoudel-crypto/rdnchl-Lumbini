define(['N/search', 'N/record', './rdlib/js/nepali.datepicker.v3.7.min', 'N/runtime', 'N/format'],
    function (search, record, npCalendar, runtime, format) {
        return {
            findcustomer: function (option) {
                log.debug({title: 'SRCH_CUST_OPTION', details: option});
                try {
                    let customer = {type: 'CUSTOMER_DETAIL'};
                    let customerId = -9999;
                    let customerAddress = '';
                    const s = search.create({
                        type: search.Type.CUSTOMER,
                        filters: [
                            ["custentity_customer_code", "is", option.customer_code],
                            "AND",
                            ["isinactive", "is", "F"]
                        ],
                        columns: ['entityid', 'altname', 'custentity_pan', 'custentity_customer_code', 'address']
                        //columns: ['address']
                    });
                    s.run().each(result => {
                        customer = {
                            customer_id: result.id,
                            customer_name: result.getValue('altname'),
                            customer_pan: result.getValue('custentity_pan'),
                            customer_code: result.getValue('custentity_customer_code'),
                            customer_address: result.getValue('address')
                        }
                    });
                    if (!customer.hasOwnProperty('customer_id')) {
                        customer.error_code = 'CUST_NOT_FOUND';
                        customer.error_message = `Customer with customer code '${option.customer_code}' does not exist`;
                    }

                    return customer;
                } catch (e) {
                    log.error({
                        title: e.name,
                        details: e
                    });
                    return {
                        type: 'ERROR',
                        title: e.name,
                        details: e
                    };
                }
            },
            findDealer: function (option) {
                log.debug({title: 'SRCH_DLR_OPTION', details: option});
                try {
                    const s = search.create({
                        type: search.Type.CUSTOMER,
                        filters: [
                            ["custentity_customer_code", "is", option.dealer_code],
                            "AND",
                            ["isinactive", "is", "F"],
                            "AND",
                            ["custentity_is_dealer", "is", "T"]
                        ],
                        columns: ['entityid', 'custentity_pan', 'custentity_customer_code']
                    });
                    let dealer = {type: 'DEALER_DETAIL'};
                    s.run().each(result => {
                        dealer = {
                            dealer_name: result.getValue('entityid'),
                            dealer_code: result.getValue('custentity_customer_code'),
                            dealer_id: result.id
                        }
                    });
                    return dealer;
                } catch (e) {
                    log.error({
                        title: e.name,
                        details: e
                    });
                    return {
                        type: 'ERROR',
                        title: e.name,
                        details: e
                    };
                }
            },
            getuserdetails: function (option) {
                log.debug({title: 'OPT', details: option});
                try {
                    let entity = {};
                    const dealerField = search.createColumn({
                        name: 'entityid',
                        join: 'CUSTENTITY_PARENT_DEALER'
                    });
                    const dealerIdField = search.createColumn({
                        name: 'internalid',
                        join: 'CUSTENTITY_PARENT_DEALER'
                    });
                    const s = search.create({
                        type: search.Type.CUSTOMER,
                        filters: [
                            ["custentity_customer_code", "is", option.customer_code],
                            "AND",
                            ["isinactive", "is", "F"]
                        ],
                        columns: ['entityid', 'custentity_pan', 'custentity_customer_code', dealerIdField, dealerField]
                    });
                    const dealers = [];
                    s.run().each(result => {
                        entity = {
                            id: result.id,
                            name: result.getValue('entityid'),
                            pan: result.getValue('custentity_pan'),
                            code: result.getValue('custentity_customer_code'),
                        };
                    });
                    s.run().each(result => {
                        dealers.push({
                            dealer_id: result.getValue(dealerIdField),
                            dealer_name: result.getValue(dealerField)
                        });
                        return true;
                    });
                    entity.dealers = dealers;
                    return entity;
                } catch (e) {
                    log.error({title: e.name, details: e});
                    return e;
                }
            },
            getinvoiceamount: function (option) {
                try {
                    /*const s = search.load({
                        id: 'customsearch_getbalance_npi'
                    })*/
                    const filters = [
                        ["posting", "is", "T"],
                        "AND",
                        ["accounttype", "anyof", "AcctRec"],
                        "AND",
                        ["name", "anyof", option.entityid]
                    ]
                    if (option.hasOwnProperty('subsidiary') && option.subsidiary) {
                        filters.push("AND", ["subsidiary", "anyof", option.subsidiary])
                    }
                    if (option.dealerid) {
                        filters.push("AND", ["custbody_dealer_new", "anyof", option.dealerid]);
                    }
                    const debitCol = search.createColumn({name: 'debitamount', summary: 'SUM'})
                    const creditCol = search.createColumn({name: 'creditamount', summary: 'SUM'})
                    //s.filterExpression = filters
                    const s = search.create({
                        type: search.Type.TRANSACTION,
                        filters: filters,
                        columns: [debitCol, creditCol]
                    })
                    let invoice = {type: 'INVOICE'}
                    s.run().each(result => {
                        let dr = parseFloat(result.getValue(debitCol))
                        let cr = parseFloat(result.getValue(creditCol))
                        dr = isNaN(dr) ? 0 : dr
                        cr = isNaN(cr) ? 0 : cr
                        const balance = dr - cr
                        invoice = {
                            invoice_total: balance > 0 ? format.format({
                                value: balance,
                                type: format.Type.CURRENCY2
                            }) : "0.00",
                            balance: balance >= 0 ? "0.00" : format.format({
                                value: (balance * -1),
                                type: format.Type.CURRENCY2
                            })
                        }
                    })
                    return invoice
                } catch (e) {
                    log.error({
                        title: e.name,
                        details: e
                    })
                    return {
                        type: 'ERROR',
                        title: e.name,
                        details: e
                    };
                }
            },
            getinvoicelist: function (option) {
                try {
                    const filters = [
                        ["mainline", "is", "T"],
                        "AND",
                        ["name", "anyof", option.entityid],
                        "AND",
                        ["status", "anyof", "CustInvc:A"]
                    ]
                    if (option.hasOwnProperty('subsidiary') && option.subsidiary) {
                        filters.push("AND", ["subsidiary", "anyof", option.subsidiary])
                    }
                    const s = search.create({
                        type: search.Type.INVOICE,
                        filters: filters,
                        columns: ['trandate', 'tranid', 'amount']
                    });
                    const invoiceList = [];
                    const result = s.run().getRange({start: 0, end: 5});
                    for (let x = 0; x < result.length; x++) {
                        invoiceList.push({
                            invoice_id: result[x].id,
                            invoice_date: result[x].getValue('trandate'),
                            invoice_number: result[x].getValue('tranid'),
                            invoice_amount: result[x].getValue('amount')
                        });
                    }
                    return invoiceList;
                } catch (e) {
                    log.error({title: e.name, details: e});
                    return e;
                }
            },
            getpaymentdefaults: function () {
                const npipaymentsetup = record.load({
                    type: 'customrecord_npi_custjob_pmt_setup',
                    id: '1'
                })
                return {
                    account: npipaymentsetup.getValue('custrecord_default_account'),
                    location: npipaymentsetup.getValue('custrecord_default_location')
                }
            },
            savepayment: function (option) {
                log.debug({title: 'PAYMENT_REC_OPTION', details: option});
                const steelsgroup = ['38', '36', '37'];
                const plasticgroup = ['40', '41', '42'];
                try {
                    const paymentsetup = this.getpaymentdefaults()
                    log.debug('PMT_SETUP', paymentsetup)
                    const defaults = {};
                    if (option.hasOwnProperty('subsidiary') && option.subsidiary) {
                        //let accountid = '';
                        if (steelsgroup.includes(option.subsidiary)) {
                            defaults.customform = '153';
                            //accountid = '744';
                        } else if (plasticgroup.includes(option.subsidiary)) {
                            defaults.customform = '115';
                            //accountid = '829';
                        }
                    }
                    const custR = record.create({
                        type: record.Type.CUSTOMER_PAYMENT,
                        defaultValues: defaults,
                        isDynamic: true
                    });
                    custR.setValue({
                        fieldId: 'customer',
                        value: option.entityid
                    });
                    const trandate = custR.getValue('trandate');
                    const npDate = npCalendar.AD2BS({
                        year: trandate.getFullYear(),
                        month: trandate.getMonth() + 1,
                        day: trandate.getDate()
                    });
                    custR.setValue({
                        fieldId: 'custbodynpdate',
                        value: `${npDate.day}/${npDate.month}/${npDate.year}`
                    });
                    custR.setValue({
                        fieldId: 'memo',
                        value: `Generated from NCHL ${option.memo}`
                    });
                    custR.setValue({
                        fieldId: 'undepfunds',
                        value: "F"
                    });
                    if (option.hasOwnProperty('subsidiary') && option.subsidiary) {
                        custR.setValue({
                            fieldId: 'subsidiary',
                            value: option.subsidiary
                        });
                        const subsidiaryConfig = search.lookupFields({
                            type: search.Type.SUBSIDIARY,
                            id: option.subsidiary,
                            columns: ['custrecord_default_receipt_location', 'custrecord_default_receipt_account']
                        });
                        log.debug({title: 'SUBS_CONF', details: subsidiaryConfig});
                        custR.setValue({
                            fieldId: 'account',
                            value: subsidiaryConfig.custrecord_default_receipt_account[0].value
                        });
                        custR.setValue({
                            fieldId: 'location',
                            value: subsidiaryConfig.custrecord_default_receipt_location[0].value
                        });
                    } else {
                        custR.setValue({
                            fieldId: 'account',
                            value: paymentsetup.account
                        })
                        custR.setValue({
                            fieldId: 'location',
                            value: paymentsetup.location
                        })
                    }

                    /*
                    if (option.dealer_id) {
                        custR.setValue({
                            fieldId: 'custbody_dealer_new',
                            value: option.dealer_id
                        });
                    }*/

                    /*const salesType = search.lookupFields({
                        type: search.Type.CUSTOMER,
                        id: option.entityid,
                        columns: 'cseg3'
                    });
                    custR.setValue({
                        fieldId: 'cseg3',
                        value: salesType.cseg3[0].value
                    });
                   */

                    custR.setValue({
                        fieldId: 'payment',
                        value: option.amount
                    });
                    const applyCount = custR.getLineCount({sublistId: 'apply'});
                    log.debug('linecount', applyCount);
                    if (applyCount > 0) {
                        for (let i = 0; i < applyCount; i++) {
                            custR.selectLine({sublistId: 'apply', line: i});
                            custR.setCurrentSublistValue({sublistId: 'apply', fieldId: 'apply', value: true});
                        }
                    }
                    custR.setValue({
                        fieldId: 'custbody_npi_tran_no',
                        value: option.npi_tran_no
                    });
                    //const paymentRecordId = '99999';
                    const paymentRecordId = custR.save();
                    log.debug({title: 'RECORD_SAVED', details: `Payment saved record = ${paymentRecordId}`});
                    if (paymentRecordId) {
                        return {
                            status: 'success',
                            message: 'Payment record saved successfully.'
                        }
                    } else {
                        return {
                            status: 're-push',
                            message: 'Failed to save payment.'
                        };
                    }
                } catch (e) {
                    log.debug({title: e.name, details: e});
                    return {
                        status: 're-push',
                        message: 'Failed to save payment.'
                    };
                }
            },
            findrecordbynchlno: function (nchltranno) {
                let found = false
                search.create({
                    type: search.Type.CUSTOMER_PAYMENT,
                    filters: [
                        ["custbody_npi_tran_no", "is", nchltranno]
                    ]
                }).run().each(res => {
                    log.debug({title: 'RECORD_EXIST', details: res})
                    found = true
                })
                return found
            }
        };
    });