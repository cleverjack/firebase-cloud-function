const functions = require('firebase-functions');
const admin = require('firebase-admin');

/**
 * Error Handler
 * @param e
 */
function errorHandler(e) {
    console.error(e)
    return Promise.reject(e);
}

let app;

/**
 * Get Database Reference
 * @param path
 * @returns {admin.database.Reference}
 */
function getDatabaseRef(context, path) {
    const appOptions = JSON.parse(process.env.FIREBASE_CONFIG);
    appOptions.databaseAuthVariableOverride = context.auth;
    if (!app) {
        app = admin.initializeApp(appOptions, 'app');
    }
    return app.database().ref(path);
}

/**
 * Add Cost To Client's Profit when Service is created
 * @param {*} context 
 * @param {*} service 
 */
function addCost(context, service) {
    const { parts, labourTransportCosts, date: createdAt } = service;
    const month = new Date(createdAt).getMonth() + 1;
    const year = new Date(createdAt).getFullYear();
    const ref = getDatabaseRef(context, '/counts/sales/unpaid/' + year + '/' + month);
    return Promise.all([
        ref.transaction(function (value) {
            value = value || {};
            value.cost = value.cost || 0;
            value.count = value.count || 0;
            (parts || []).forEach(part => {
                const { partCost } = part;
                if (partCost && !isNaN(partCost)) {
                    value.cost = value.cost + parseFloat(partCost);
                }
            });
            if (labourTransportCosts && !isNaN(labourTransportCosts)) {
                value.cost = value.cost + parseFloat(labourTransportCosts);
            }
            value.count = value.count + 1;
            return value;
        })
    ]);
}
function getDifference(before, after) {
    return {
        after,
        before,
        labourTransportCosts: (after.labourTransportCosts || 0) ,
        partsCosts: (after.parts || []).reduce((sum, part) => {
            const { partCost } = part;
            if (partCost && !isNaN(partCost)) {
                sum = sum + parseFloat(partCost);
            }
            return sum;
        }, 0)
    }
}
function updateCost(context, before, after) {
    const { partsCosts, labourTransportCosts, before: { date: beforeDate }, after: { date: updatedAt } } = getDifference(before, after);
    const month = new Date(updatedAt).getMonth() + 1;
    const year = new Date(updatedAt).getFullYear();
    const ref = getDatabaseRef(context, '/counts/sales/paid/' + year + '/' + month);
    const beforeMonth = new Date(beforeDate).getMonth() + 1;
    const beforeYear = new Date(beforeDate).getFullYear();
    const ref2 = getDatabaseRef(context, '/counts/sales/unpaid/' + beforeYear + '/' + beforeMonth);
    return Promise.all([
        ref.transaction(function (value) {
            value=value||{};
            value.cost = value.cost || 0;
            value.count = value.count||0;
            if (partsCosts) {
                value.cost = value.cost + partsCosts;
            }
            if (labourTransportCosts) {
                value.cost = value.cost + labourTransportCosts;
            }
            value.count=value.count+1;
            return value;
        }),
        ref2.transaction(function (value) {
            value=value||{};
            value.cost = value.cost || 0;
            value.count = value.count||0;
            if (partsCosts) {
                value.cost = value.cost - partsCosts;
            }
            if (labourTransportCosts) {
                value.cost = value.cost - labourTransportCosts;
            }
            value.count=value.count-1;
            return value;
        })
    ]);
}


function deleteCost(context, service) {
    const { parts, labourTransportCosts, createdAt,paid } = service;
    const month = new Date(createdAt).getMonth() + 1;
    const year = new Date(createdAt).getFullYear();
    const ref = getDatabaseRef(context, `/counts/sales/paid/${year}/${month}`);
    return Promise.all([
        ref.transaction(function (value) {
            const partsCosts = (parts|| []).reduce((sum, part) => {
                const { partCost } = part;
                if (partCost && !isNaN(partCost)) {
                    sum = sum + parseFloat(partCost);
                }
                return sum;
            }, 0)
            value=value||{};
            value.cost = value.cost || 0;
            value.count = value.count||0;
            if (partsCosts) {
                value.cost = value.cost - partsCosts;
            }
            if (labourTransportCosts) {
                value.cost = value.cost - labourTransportCosts;
            }
            value.count=value.count-1;
            return value;
        })
    ]);
}
/**
 * Increment Value by 1 at a path
 * @param context
 * @param path
 * @returns {Promise.<void>}
 */
function incrementValueAtLocation(context, path) {
    const ref = getDatabaseRef(context, path);
    return ref.transaction(function (value) {
        console.log("Value is", value);
        if (value == null || value == undefined) {
            value = 0;
        }
        return value + 1;
    });
}

/**
 * Increment Value by 1 at a path
 * @param context
 * @param path
 * @returns {Promise.<void>}
 */
function decrementValueAtLocation(context, path) {
    const ref = getDatabaseRef(context, path);
    return ref.transaction(function (value) {
        console.log("Value is", value)
        if (value === null || value === undefined) {
            value = 0;
        }
        return value > 0 ? value - 1 : 0;
    });
}


/**
 * On User Create
 * @param snapshot
 * @param context
 * @returns {*}
 */
function onUserAdd(snapshot, context) {
    const id = context.params.id;
    const val = snapshot.val();
    console.log(`New User Created ${id}`, val);
    console.log(` User Updated Body - ${val.role} ${val.id} `);
    return Promise.all([
        incrementValueAtLocation(context, `/counts/users/${val.role}`).catch(errorHandler),
        incrementValueAtLocation(context, '/ids/users').catch(errorHandler),
        app.auth().setCustomUserClaims(id, { role: val.role, id: val.id }).catch(errorHandler)
    ]);
}

/**
 * On User Update
 * @param snapshot
 * @param context
 * @returns
 */
function onUserUpdate(snapshot, context) {
    const id = context.params.id;
    const val = snapshot.after.val();
    console.log(` User Updated ${id}`, val);
    console.log(` User Updated Body - ${val.role} ${val.id} `);
    getDatabaseRef(context, `/users/${id}`);
    return app.auth().setCustomUserClaims(id, { role: val.role, id: val.id }).catch(errorHandler);
}


/**
 * On User Remove
 * @param snapshot
 * @param context
 * @returns {*}
 */
function onUserRemove(snapshot, context) {
    const id = context.params.id;
    const val = snapshot.val();
    console.log(`User Removed ${id}`);
    return Promise.all([
        decrementValueAtLocation(context, `/counts/users/${val.role}`).catch(errorHandler),
        getDatabaseRef(context, `users/${id}`).remove()
    ]);
}

/**
 * On User Create
 * @param snapshot
 * @param context
 * @returns {*}
 */
function onRoleAdd(snapshot, context) {
    const id = context.params.id;
    console.log(`New Role Created ${id}`);
    return Promise.all([
        incrementValueAtLocation(context, '/counts/roles').catch(errorHandler)
    ]);
}


/**
 * On Role Remove
 * @param snapshot
 * @param context
 * @returns {*}
 */
function onRoleRemove(snapshot, context) {
    const id = context.params.id;
    console.log(`Role Removed ${id}`);
    return Promise.all([
        decrementValueAtLocation(context, '/counts/roles').catch(errorHandler)
    ]);
}

/**
 * on Service Job Created
 * @param {*} snapshot 
 * @param {*} context 
 */
function onServiceAdd(snapshot, context) {
    const { id } = context.params;
    const { jobStatus } = snapshot.val();
    console.log(`'Service Added ${id}`);
    return Promise.all([
        incrementValueAtLocation(context, '/counts/service/' + jobStatus).catch(errorHandler),
        //addCost(context, snapshot.val()).catch(errorHandler)
    ])
}

/**
 * on Service Deleted
 * @param {*} snapshot 
 * @param {*} context 
 */
function onServiceDelete(snapshot, context) {
    const { id } = context.params;
    const service = snapshot.val();
    console.log(`'Service Deleted ${id}`);
    let array = [decrementValueAtLocation(context, '/counts/service/' + service.jobStatus).catch(errorHandler)];
    if(service.jobStatus === "Completed"){
        array.push(deleteCost(context, service));
        array.push(getDatabaseRef(context, `invoice/${id}`).remove());
    }
    return Promise.all(array)
}


/**
 * on Service Updated
 */
function onServiceUpdate(snapshot, context) {
    const { id } = context.params;
    const before = snapshot.before.val();
    const after = snapshot.after.val();
    const { jobStatus } = before;
    const { jobStatus: afterJobStatus } = after;
    console.log(`'Service Updated ${id}`);
    let array = [];
    if (jobStatus && afterJobStatus && jobStatus !== afterJobStatus) {
        array.push(
            incrementValueAtLocation(context, '/counts/service/' + afterJobStatus).catch(errorHandler),
            decrementValueAtLocation(context, '/counts/service/' + jobStatus).catch(errorHandler)
        )
    }
    return Promise.all([
        ...array,
        //updateCost(context, before, after)
    ])
}


/**
 * on Invoice Created
 */
function onInvoiceCreated(snapshot, context) {
    return Promise.all[
        incrementValueAtLocation(context, '/ids/invoice').catch(errorHandler),
        addCost(context, snapshot.val()).catch(errorHandler)
    ]
}

/**
 * on Customer Created
 * @param {*} snapshot 
 * @param {*} context 
 */
function onCustomerAdd(snapshot, context) {
    return Promise.all[
        incrementValueAtLocation(context, '/counts/customer').catch(errorHandler)
    ]
}

/**
 * on Customer Deleted
 * @param {*} snapshot 
 * @param {*} context 
 */
function onCustomerRemove(snapshot, context) {
    return Promise.all[
        decrementValueAtLocation(context, '/counts/customer').catch(errorHandler)
    ]
}


/**
 * on Car Created
 * @param {*} snapshot 
 * @param {*} context 
 */
function onCarAdd(snapshot, context) {
    return Promise.all[
        incrementValueAtLocation(context, '/counts/car').catch(errorHandler)
    ]
}

/**
 * on Car Deleted
 * @param {*} snapshot 
 * @param {*} context 
 */
function onCarRemove(snapshot, context) {
    return Promise.all[
        decrementValueAtLocation(context, '/counts/car').catch(errorHandler)
    ]
}


function onInvoiceUpdate(snapshot, context) {
    const before = snapshot.before.val();
    const after = snapshot.after.val();
    return Promise.all([
        updateCost(context, before, after)
    ])
}

/**
 * Function Map to be exported
 * @type Object
 */
const functionsMap = {
    onCreate: [
        {
            key: "/car/{id}",
            callback: onCarAdd
        },
        {
            key: "/customer/{id}",
            callback: onCustomerAdd
        },
        {
            key: "/users/{id}",
            callback: onUserAdd
        },
        {
            key: "/roles/{id}",
            callback: onRoleAdd
        },
        {
            key: '/service/{id}',
            callback: onServiceAdd
        }, {
            key: '/invoice/{id}',
            callback: onInvoiceCreated
        }
    ],
    onDelete: [
        {
            key: "/car/{id}",
            callback: onCarRemove
        },
        {
            key: "/customer/{id}",
            callback: onCustomerRemove
        },
        {
            key: "/users/{id}",
            callback: onUserRemove
        },
        {
            key: "/roles/{id}",
            callback: onRoleRemove
        },
        {
            key: '/service/{id}',
            callback: onServiceDelete
        }
    ],
    onUpdate: [
        {
            key: "/users/{id}",
            callback: onUserUpdate
        },
        {
            key: '/service/{id}',
            callback: onServiceUpdate
        },
        {
            key: '/invoice/{id}',
            callback: onInvoiceUpdate
        }
    ]
};

Object.keys(functionsMap).map(type => {
    const fns = functionsMap[type];
    fns.map((fn) => {
        const { key, callback } = fn;
        exports[callback.name] = functions.database.ref(key)[type](callback);
    });
});

exports.onAuthDelete = functions.auth.user().onDelete(function (user, context) {
    console.log('onDelete' + user.uid);
    return Promise.all([
        getDatabaseRef(context, `users/${user.uid}`).remove()
    ]);
});
