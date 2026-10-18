const admin = require('firebase-admin');
const fs = require('fs');

const serviceAccount = require('./firebase-adminsdk.json');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Collections to backup and their known subcollections
const schema = {
    'users': [],
    'organizations': [],
    'elections': ['Rounds', 'Candidates', 'Keys'],
    'system_status': [],
    'audit_logs': [],
    'auth_codes': []
};

async function exportCollection(collectionRef, subCollectionsList) {
    const snapshot = await collectionRef.get();
    const data = {};
    for (const doc of snapshot.docs) {
        data[doc.id] = {
            _data: doc.data(),
            _subCollections: {}
        };
        
        for (const subCollName of subCollectionsList) {
            const subCollRef = doc.ref.collection(subCollName);
            data[doc.id]._subCollections[subCollName] = await exportCollection(subCollRef, []); // Assumes sub-sub collections aren't needed here
        }
    }
    return data;
}

async function backupFirestore() {
    console.log('Starting optimized Firestore backup...');
    try {
        const rootCollections = await db.listCollections();
        const backupData = {};
        for (const coll of rootCollections) {
            console.log(`Exporting collection: ${coll.id}`);
            const subs = schema[coll.id] || []; // Only check known subcollections
            backupData[coll.id] = await exportCollection(coll, subs);
        }
        
        const outputPath = '../firestore_backup.json';
        fs.writeFileSync(outputPath, JSON.stringify(backupData, null, 2));
        console.log(`✅ Backup successfully saved to ${outputPath}`);
    } catch (error) {
        console.error('❌ Error during backup:', error);
    }
}

backupFirestore();
