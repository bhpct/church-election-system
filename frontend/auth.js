// 您的 LIFF ID (從 LINE Developers Console 取得)
const LIFF_ID = "2010101902-5m98FoAq";
// 本地開發時的後端 API 位置
const API_BASE_URL = "https://church-election-system-1089220354332.asia-east1.run.app/api";

const loginBtn = document.getElementById('liffLoginBtn');
const spinner = document.getElementById('loadingSpinner');
const userInfo = document.getElementById('userInfo');

// 初始化 LIFF
async function initLiff() {
    try {
        await liff.init({ liffId: LIFF_ID });

        if (liff.isLoggedIn()) {
            // 已登入 LINE，開始向後端驗證並取得 Firebase Token
            await processLogin();
        } else {
            // 未登入，顯示登入按鈕
            spinner.style.display = 'none';
            loginBtn.style.display = 'block';
        }
    } catch (err) {
        console.error('LIFF 初始化失敗:', err);
        Swal.fire('錯誤', 'LINE LIFF 初始化失敗，請確認 LIFF ID 是否正確', 'error');
        spinner.style.display = 'none';
    }
}

// 點擊登入按鈕
function handleLiffLogin() {
    // 開啟 LINE 授權畫面
    liff.login();
}

// 處理登入流程：取得 idToken -> 傳給後端 -> 登入 Firebase
async function processLogin() {
    try {
        spinner.style.display = 'block';
        loginBtn.style.display = 'none';

        // 1. 取得 LINE idToken
        const idToken = liff.getIDToken();
        if (!idToken) throw new Error('無法取得 LINE 登入憑證');

        // 2. 傳送給我們的 Node.js 後端進行驗證
        const response = await fetch(`${API_BASE_URL}/auth/verify`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ idToken })
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.message || '後端驗證失敗');
        }

        // 3. 取得後端派發的 Firebase Custom Token
        const firebaseToken = result.data.firebaseToken;
        const user = result.data.user;

        // 4. 呼叫 Firebase Auth 完成登入 (此時我們已從 index.html 繼承 window.firebaseAuth)
        if (!window.firebaseAuth || !window.signInWithCustomToken) {
            // 防呆：確保 Firebase JS SDK 已經載入
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        await window.signInWithCustomToken(window.firebaseAuth, firebaseToken);

        // 5. 登入成功，更新畫面
        spinner.style.display = 'none';
        userInfo.style.display = 'block';
        document.getElementById('userPicture').src = user.picture || 'https://via.placeholder.com/80';
        document.getElementById('userName').textContent = user.name;
        document.getElementById('userStatus').textContent = '✅ 已成功連線至 Firebase';

        Swal.fire({
            icon: 'success',
            title: '登入成功',
            text: `歡迎回來，${user.name}！`,
            timer: 1500,
            showConfirmButton: false
        });

    } catch (error) {
        console.error('登入流程發生錯誤:', error);
        Swal.fire('驗證失敗', error.message, 'error');
        spinner.style.display = 'none';
        loginBtn.style.display = 'block';
    }
}

// 畫面載入後啟動 LIFF
document.addEventListener('DOMContentLoaded', initLiff);
