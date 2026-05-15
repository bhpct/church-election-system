const admin = require('firebase-admin');
const fs = require('fs');
const serviceAccount = require('./firebase-adminsdk.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

async function deployRules() {
    console.log("開始部署 Firestore 規則...");
    try {
        const rulesContent = fs.readFileSync('../firestore.rules', 'utf8');
        
        // 使用 Firebase Admin SDK 部署規則
        await admin.securityRules().releaseFirestoreRulesetFromSource(rulesContent);
        
        console.log("🎉 Firestore 規則部署成功！");
    } catch (err) {
        console.error("規則部署失敗:", err);
    }
    process.exit(0);
}

deployRules();
