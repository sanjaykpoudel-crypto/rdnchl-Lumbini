define(['./npiconfig', 'N/http', 'N/search'], function (npiconf, http, search) {
    return {
        generatetoken: function () {
            const b64basic = btoa(npiconf.USERNAME + ':' + npiconf.PASSWORD)
            const reqHeaders = {
                "Authorization": 'Basic ' + b64basic,
                "Content-Type": "application/x-www-form-urlencoded"
            }
            const postBody = {
                "grant_type": "password",
                "username": npiconf.USERID,
                "password": npiconf.USERPASS
            }
          const tokenUrl = npiconf.HOST + '/oauth/token'
          console.log('LOG_HOST_IN_GENTOK', tokenUrl)
            const response = http.request({
                method: http.Method.POST,
                url: tokenUrl,
                headers: reqHeaders,
                body: postBody
            })
          console.log('NPI_TOKEN_RESP', response)
            return JSON.parse(response.body)
        },
        /**
         *
         * @param option
         * @param {string} option.type
         * @returns {*[]|*}
         */
        getbanklist: function (option) {
            try {
                const apiAuth = this.generatetoken()
                const uri = option.type === 'CIPS' ? '/api/getcipsbanklist' : '/api/getbanklist'
                const response = http.request({
                    method: http.Method.POST,
                    url: npiconf.HOST + uri,
                    headers: {
                        'content-type': 'application/json',
                        'authorization': 'Bearer ' + apiAuth.access_token,
                        'accept': '*/*'
                    },
                    body: {}
                })
                const responseBody = JSON.parse(response.body)
                return responseBody.sort(function (a, b) {
                    const nameA = a.bankName.toUpperCase()
                    const nameB = b.bankName.toUpperCase()
                    if (nameA < nameB) {
                        return -1;
                    }
                    if (nameA > nameB) {
                        return 1;
                    }
                })
            } catch (e) {
                console.error({
                    title: 'ERROR_NPI',
                    details: e
                })
                return []
            }
        },
        /**
         *
         * @param option
         * @param {number} option.bankId
         * @returns {*[]|*}
         */
        getbankbranchlist: function (option) {
            try {
                const apiAuth = this.generatetoken()
                const response = http.request({
                    method: http.Method.GET,
                    url: npiconf.HOST + '/api/getbranchlist/' + option.bankId,
                    headers: {
                        'content-type': 'application/json',
                        'authorization': 'Bearer ' + apiAuth.access_token,
                        'accept': '*/*'
                    },
                    body: {}
                })
                const responseBody = JSON.parse(response.body)
                return responseBody.sort(function (a, b) {
                    const nameA = a.branchName.toUpperCase()
                    const nameB = b.branchName.toUpperCase()
                    if (nameA < nameB) {
                        return -1;
                    }
                    if (nameA > nameB) {
                        return 1;
                    }
                })
            } catch (e) {
                console.error({
                    title: 'ERROR_NPI',
                    details: e
                })
                return []
            }
        },
        /**
         *
         * @param option
         * @param {string} option.bankId
         * @param {string} option.accountNumber
         * @param {string} option.accountName
         * @returns {null|string|*}
         */
        verifiaccount: function (option) {
            console.log('OPTION ->', option)
            try {
                const npiAuth = this.generatetoken()
                const response = http.request({
                    method: http.Method.POST,
                    url: npiconf.HOST + '/api/validatebankaccount',
                    headers: {
                        'content-type': 'application/json',
                        'authorization': 'Bearer ' + npiAuth.access_token,
                        'accept': '*/*'
                    },
                    body: JSON.stringify({
                        bankId: option.bankId,
                        accountId: option.accountNumber,
                        accountName: option.accountName
                    })
                })
                return JSON.parse(response.body)
            } catch (e) {
                console.error(e)
                return 'error aayo'
            }
        },
        getbillers: function (type) {
            const npiAuth = this.generatetoken()
            try {
                const response = http.request({
                    method: http.Method.POST,
                    url: npiconf.HOST + '/billers/v2/categories',
                    headers: {
                        'content-type': 'application/json',
                        'authorization': 'Bearer ' + npiAuth.access_token,
                        'accept': '*/*'
                    },
                    body: JSON.stringify({category: type})
                })
                console.log('response = ', response)
                const responseBody = JSON.parse(response.body)
                return responseBody.data ? responseBody.data : []
            } catch (e) {
                console.error({
                    title: 'ERROR_NPI',
                    details: e
                })
                return []
            }
        },
        getentitybanks: function (entityid, type) {
            const selectOptions = [{value: '', text: ''}]
            search.create({
                type: 'customrecord_rd_nchl_bank_detail',
                filters: [
                    ['custrecord_nchl_bank_entity', 'anyof', entityid],
                    'AND',
                    ['custrecord_nchl_bank_type', 'is', type]
                ],
                columns: ['name']
            }).run().each(function (result) {
                selectOptions.push({
                    value: result.id,
                    text: result.getValue('name')
                })
                return true
            })
            return selectOptions
        },
        /**
         *
         * @param option
         * @param option.api
         * @param option.requestBody
         * @returns {ClientResponse|*[]}
         */
        checktranstatus: function (option) {
            console.log(option)
            const npiAuth = this.generatetoken()
            try {
                const response = http.request({
                    method: http.Method.POST,
                    url: npiconf.HOST + option.api,
                    headers: {
                        'content-type': 'application/json',
                        'authorization': 'Bearer ' + npiAuth.access_token,
                        'accept': '*/*'
                    },
                    body: JSON.stringify(option.requestBody)
                })
               return response
            } catch (e) {
                console.error({
                    title: 'ERROR_NPI',
                    details: e
                })
                return e
            }
        }
    }
})