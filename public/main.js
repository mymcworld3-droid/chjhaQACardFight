import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    getFirestore, doc, getDoc, setDoc, updateDoc, arrayUnion, 
    serverTimestamp, runTransaction 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Firebase Config (保持不變)
const firebaseConfig = {
    apiKey: "AIzaSyDifdJmLTmwQATz__xUHSkXZ_xXOWyX-wU",
    authDomain: "question-learning.firebaseapp.com",
    projectId: "question-learning",
    storageBucket: "question-learning.firebasestorage.app",
    messagingSenderId: "1058543232092",
    appId: "1:1058543232092:web:3fcc40f5f069b6df307299",
    measurementId: "G-76ER8RGBN7"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth();
const db = getFirestore();
const provider = new GoogleAuthProvider();

// ==========================================
// 🃏 卡牌資料庫 (Card Database)
// ==========================================
const CARD_DB = [
    // SSR (5%)
    { id: 'ssr_001', name: '愛因斯坦', title: '相對論', rarity: 'SSR', type: 'sci', power: 2500, icon: 'fa-atom' },
    { id: 'ssr_002', name: '秦始皇', title: '祖龍', rarity: 'SSR', type: 'his', power: 2400, icon: 'fa-dragon' },
    { id: 'ssr_003', name: '達文西', title: '萬能者', rarity: 'SSR', type: 'art', power: 2350, icon: 'fa-palette' },
    
    // SR (15%)
    { id: 'sr_001', name: '拿破崙', title: '戰神', rarity: 'SR', type: 'war', power: 1800, icon: 'fa-person-rifle' },
    { id: 'sr_002', name: '居禮夫人', title: '放射線', rarity: 'SR', type: 'sci', power: 1750, icon: 'fa-flask' },
    { id: 'sr_003', name: '李白', title: '詩仙', rarity: 'SR', type: 'art', power: 1700, icon: 'fa-pen-nib' },
    { id: 'sr_004', name: '諸葛亮', title: '臥龍', rarity: 'SR', type: 'his', power: 1850, icon: 'fa-fan' },

    // R (30%)
    { id: 'r_001', name: '牛頓', title: '蘋果', rarity: 'R', type: 'sci', power: 1200, icon: 'fa-apple-whole' },
    { id: 'r_002', name: '孔子', title: '至聖', rarity: 'R', type: 'his', power: 1150, icon: 'fa-scroll' },
    { id: 'r_003', name: '莎士比亞', title: '劇作家', rarity: 'R', type: 'art', power: 1100, icon: 'fa-feather' },
    { id: 'r_004', name: '織田信長', title: '魔王', rarity: 'R', type: 'war', power: 1250, icon: 'fa-fire' },

    // N (50%)
    { id: 'n_001', name: '步兵', title: '士兵', rarity: 'N', type: 'war', power: 500, icon: 'fa-person' },
    { id: 'n_002', name: '弓手', title: '士兵', rarity: 'N', type: 'war', power: 450, icon: 'fa-bow-arrow' },
    { id: 'n_003', name: '鍊金術士', title: '學徒', rarity: 'N', type: 'sci', power: 480, icon: 'fa-vial' },
    { id: 'n_004', name: '吟遊詩人', title: '路人', rarity: 'N', type: 'art', power: 420, icon: 'fa-music' },
];

const GACHA_RATES = { SSR: 0.05, SR: 0.20, R: 0.50 }; // N = 1 - 0.5 = 0.5

// 狀態變數
let currentUserData = null;
let quizBuffer = [];
const BUFFER_SIZE = 3;
let isFetchingQuiz = false;

// ==========================================
// 🚀 Auth & Init
// ==========================================
window.googleLogin = () => signInWithPopup(auth, provider).catch(e => alert(e.message));
window.logout = () => signOut(auth).then(() => location.reload());

onAuthStateChanged(auth, async (user) => {
    if (user) {
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('bottom-nav').classList.remove('hidden');
        
        // 載入或建立使用者資料
        const userRef = doc(db, "users", user.uid);
        const docSnap = await getDoc(userRef);
        
        if (docSnap.exists()) {
            currentUserData = docSnap.data();
            // 補丁：確保有 cardInventory 欄位
            if (!currentUserData.cardInventory) currentUserData.cardInventory = [];
            if (!currentUserData.gold) currentUserData.gold = 0; // 改用 gold 代替 score
        } else {
            // 新帳號初始化
            currentUserData = {
                uid: user.uid,
                displayName: user.displayName,
                email: user.email,
                gold: 500, // 初始資金
                cardInventory: [], 
                totalPower: 0,
                createdAt: serverTimestamp()
            };
            await setDoc(userRef, currentUserData);
        }

        updateUIHeader();
        renderHomeHero();
        switchToPage('page-home');
        fillQuizBuffer(); // 預載題目

    } else {
        document.getElementById('login-screen').classList.remove('hidden');
        document.getElementById('bottom-nav').classList.add('hidden');
    }
});

// ==========================================
// 🏠 UI & Navigation
// ==========================================
function updateUIHeader() {
    if (!currentUserData) return;
    
    // 計算總戰力 (Top 5 Cards Power)
    const cards = currentUserData.cardInventory.map(c => CARD_DB.find(db => db.id === c.cardId)).filter(Boolean);
    cards.sort((a, b) => b.power - a.power);
    const topPower = cards.slice(0, 5).reduce((sum, c) => sum + c.power, 0);
    
    currentUserData.totalPower = topPower; // Update local state

    document.getElementById('header-name').innerText = currentUserData.displayName;
    document.getElementById('header-gold').innerText = currentUserData.gold;
    document.getElementById('header-power').innerText = topPower;
    
    // 計算等級 (簡易版：戰力/1000)
    const level = Math.floor(topPower / 1000) + 1;
    document.getElementById('header-level').innerText = level;
}

// 首頁看板娘 (最強的一張卡)
function renderHomeHero() {
    const container = document.getElementById('home-hero-display');
    if (!currentUserData.cardInventory || currentUserData.cardInventory.length === 0) {
        container.innerHTML = `
            <div class="text-center text-gray-500 animate-pulse">
                <i class="fa-solid fa-ghost text-6xl mb-4 opacity-50"></i>
                <p class="text-xs">尚無契約英靈</p>
                <p class="text-[10px] mt-2">快去召喚吧！</p>
            </div>`;
        return;
    }

    // 找最強卡
    const cards = currentUserData.cardInventory.map(c => CARD_DB.find(db => db.id === c.cardId)).filter(Boolean);
    cards.sort((a, b) => b.power - a.power);
    const hero = cards[0];
    
    const colorMap = { 'SSR': 'text-yellow-400 border-yellow-500/50', 'SR': 'text-purple-400 border-purple-500/50', 'R': 'text-blue-400 border-blue-500/50', 'N': 'text-gray-400 border-gray-600/50' };
    const bgMap = { 'SSR': 'bg-yellow-900/20', 'SR': 'bg-purple-900/20', 'R': 'bg-blue-900/20', 'N': 'bg-gray-800/50' };

    container.className = `relative w-64 h-96 rounded-xl flex flex-col items-center justify-center border-2 shadow-2xl backdrop-blur-sm transition-all duration-500 ${colorMap[hero.rarity]} ${bgMap[hero.rarity]}`;
    
    container.innerHTML = `
        <div class="absolute top-4 left-4 text-xs font-black px-2 py-1 rounded bg-black/50">${hero.rarity}</div>
        <div class="text-9xl mb-6 filter drop-shadow-lg transform hover:scale-110 transition duration-300">
            <i class="fa-solid ${hero.icon}"></i>
        </div>
        <div class="text-center z-10">
            <div class="text-xs opacity-75 tracking-widest mb-1">${hero.title}</div>
            <div class="text-2xl font-black tracking-wide">${hero.name}</div>
            <div class="mt-4 bg-black/40 px-4 py-1 rounded-full text-sm font-mono border border-white/10">
                戰力 ${hero.power}
            </div>
        </div>
        <div class="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent rounded-xl pointer-events-none"></div>
    `;
}

window.switchToPage = (pageId) => {
    document.querySelectorAll('.page-section').forEach(el => el.classList.add('hidden'));
    document.getElementById(pageId).classList.remove('hidden');
    
    document.querySelectorAll('.nav-btn').forEach(btn => {
        if (btn.dataset.target === pageId) btn.classList.add('active');
        else btn.classList.remove('active');
    });

    if (pageId === 'page-home') {
        updateUIHeader();
        renderHomeHero();
    }
};

// ==========================================
// ⚔️ 討伐 (Quiz Farming)
// ==========================================
window.startAdventure = async () => {
    switchToPage('page-adventure');
    // 如果緩衝區沒題目，先顯示 Loading
    if (quizBuffer.length === 0) {
        document.getElementById('quiz-loading').classList.remove('hidden');
        document.getElementById('quiz-container').classList.add('hidden');
        await fetchOneQuestion(); // 強制抓一題
    }
    renderNextQuestion();
};

async function fetchOneQuestion() {
    isFetchingQuiz = true;
    try {
        // 使用你的後端 API
        const response = await fetch('/api/generate-quiz', {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                subject: "History", // 可以隨機換
                level: "General", 
                rank: "Novice", 
                difficulty: "easy",
                language: currentLang 
            })
        });
        
        const data = await response.json();
        // 簡單解析 JSON (假設後端回傳格式正確)
        let aiText = data.text.replace(/```json/g, '').replace(/```/g, '').trim();
        const quizData = JSON.parse(aiText);
        
        // 混淆選項
        let options = [quizData.correct, ...quizData.wrong];
        options.sort(() => Math.random() - 0.5);
        
        quizBuffer.push({ ...quizData, options });
    } catch (e) {
        console.error("Fetch Quiz Error:", e);
    } finally {
        isFetchingQuiz = false;
    }
}

async function fillQuizBuffer() {
    if (isFetchingQuiz) return;
    while (quizBuffer.length < BUFFER_SIZE) {
        await fetchOneQuestion();
    }
}

function renderNextQuestion() {
    if (quizBuffer.length === 0) {
        fillQuizBuffer(); // 觸發補充
        return; // 等待中
    }

    const quiz = quizBuffer.shift();
    fillQuizBuffer(); // 背景補貨

    document.getElementById('quiz-loading').classList.add('hidden');
    document.getElementById('quiz-container').classList.remove('hidden');
    document.getElementById('quiz-feedback').classList.add('hidden');

    document.getElementById('question-text').innerText = quiz.q;
    const container = document.getElementById('options-container');
    container.innerHTML = '';

    quiz.options.forEach((opt, idx) => {
        const btn = document.createElement('button');
        btn.className = "w-full text-left p-4 bg-slate-700 hover:bg-slate-600 rounded-xl transition border border-slate-600 flex items-center active:scale-95";
        btn.innerHTML = `<div class="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-sm font-bold mr-4 text-gray-400">${String.fromCharCode(65+idx)}</div><span class="text-sm font-bold text-gray-200">${opt}</span>`;
        btn.onclick = () => handleAdventureAnswer(opt === quiz.correct);
        container.appendChild(btn);
    });
}

window.handleAdventureAnswer = async (isCorrect) => {
    const fb = document.getElementById('quiz-feedback');
    const icon = document.getElementById('fb-icon');
    const title = document.getElementById('fb-title');
    const reward = document.getElementById('fb-reward');

    fb.classList.remove('hidden');

    if (isCorrect) {
        icon.className = "fa-solid fa-sack-dollar text-6xl mb-4 text-yellow-400 animate-bounce";
        title.innerText = "討伐成功！";
        title.className = "text-3xl font-black mb-2 text-yellow-400";
        reward.innerHTML = "+50 <span class='text-xs'>Gold</span>";
        
        // 加錢
        currentUserData.gold += 50;
        await updateDoc(doc(db, "users", auth.currentUser.uid), { gold: currentUserData.gold });
        updateUIHeader();
    } else {
        icon.className = "fa-solid fa-skull text-6xl mb-4 text-gray-500 animate-pulse";
        title.innerText = "討伐失敗...";
        title.className = "text-3xl font-black mb-2 text-gray-400";
        reward.innerText = "獲得 0 G";
    }
};

window.nextQuestion = () => {
    renderNextQuestion();
};

window.giveUpQuiz = () => {
    switchToPage('page-home');
};

// ==========================================
// 💎 召喚 (Gacha)
// ==========================================
window.performSummon = async (count) => {
    if (!currentUserData) return;
    const COST = 100;
    const totalCost = COST * count;

    if (currentUserData.gold < totalCost) {
        return alert(`金幣不足！需要 ${totalCost} G`);
    }

    if (!confirm(`花費 ${totalCost} G 進行 ${count} 次召喚？`)) return;

    try {
        const pulledCards = [];
        for (let i = 0; i < count; i++) {
            const rand = Math.random();
            let rarity = 'N';
            if (rand < GACHA_RATES.SSR) rarity = 'SSR';
            else if (rand < GACHA_RATES.SR) rarity = 'SR';
            else if (rand < GACHA_RATES.R) rarity = 'R';

            const pool = CARD_DB.filter(c => c.rarity === rarity);
            const card = pool[Math.floor(Math.random() * pool.length)];
            
            pulledCards.push({
                uid: Math.random().toString(36).substr(2, 9),
                cardId: card.id,
                obtainedAt: Date.now()
            });
        }

        const newGold = currentUserData.gold - totalCost;
        let currentDeck = currentUserData.cardInventory || [];
        const updatedDeck = [...currentDeck, ...pulledCards];

        // Optimistic UI Update
        currentUserData.gold = newGold;
        currentUserData.cardInventory = updatedDeck;
        updateUIHeader();

        // Save to DB
        const userRef = doc(db, "users", auth.currentUser.uid);
        await updateDoc(userRef, {
            gold: newGold,
            cardInventory: updatedDeck
        });

        showGachaResults(pulledCards);

    } catch (e) {
        console.error(e);
        alert("召喚發生錯誤，請檢查網路");
    }
};

function showGachaResults(cards) {
    const overlay = document.getElementById('gacha-result-overlay');
    const container = document.getElementById('gacha-cards-container');
    const anim = document.getElementById('gacha-animation');
    
    overlay.classList.remove('hidden');
    container.innerHTML = '';
    anim.classList.remove('hidden');

    setTimeout(() => {
        anim.classList.add('hidden');
        cards.forEach((item, idx) => {
            const cardData = CARD_DB.find(c => c.id === item.cardId);
            const el = document.createElement('div');
            el.className = `card-frame rarity-${cardData.rarity} card-reveal`;
            el.style.animationDelay = `${idx * 0.15}s`; // 依序翻牌
            el.innerHTML = renderCardHTML(cardData);
            container.appendChild(el);
        });
    }, 1200);
}

window.closeGachaResult = () => {
    document.getElementById('gacha-result-overlay').classList.add('hidden');
};

// ==========================================
// 📦 牌組 (Deck)
// ==========================================
window.loadUserDeck = () => {
    renderDeck('all');
};

window.renderDeck = (filter) => {
    const container = document.getElementById('deck-grid');
    const countEl = document.getElementById('deck-count');
    container.innerHTML = '';

    if (!currentUserData.cardInventory || currentUserData.cardInventory.length === 0) {
        countEl.innerText = 0;
        container.innerHTML = '<div class="col-span-full text-center text-gray-500 mt-10">空空如也</div>';
        return;
    }

    let myCards = currentUserData.cardInventory.map(item => {
        return { ...item, data: CARD_DB.find(c => c.id === item.cardId) };
    });

    if (filter !== 'all') {
        myCards = myCards.filter(c => c.data.rarity === filter);
    }

    // 排序: 稀有度 -> 戰力
    const rarityVal = { 'SSR': 4, 'SR': 3, 'R': 2, 'N': 1 };
    myCards.sort((a, b) => {
        if (rarityVal[b.data.rarity] !== rarityVal[a.data.rarity]) 
            return rarityVal[b.data.rarity] - rarityVal[a.data.rarity];
        return b.data.power - a.data.power;
    });

    countEl.innerText = myCards.length;

    myCards.forEach(c => {
        const div = document.createElement('div');
        div.className = `card-frame rarity-${c.data.rarity}`;
        div.innerHTML = renderCardHTML(c.data);
        container.appendChild(div);
    });
};

// 通用卡牌渲染
function renderCardHTML(card) {
    const colorMap = { 'SSR': 'text-yellow-400', 'SR': 'text-purple-400', 'R': 'text-blue-400', 'N': 'text-gray-400' };
    return `
        <div class="card-inner">
            <div class="flex justify-between items-start mb-1">
                <span class="card-badge ${card.rarity === 'SSR' ? 'bg-yellow-600' : 'bg-slate-700'}">${card.rarity}</span>
                <i class="fa-solid ${getAttrIcon(card.type)} text-[10px] text-gray-400"></i>
            </div>
            <div class="card-image ${colorMap[card.rarity]}">
                <i class="fa-solid ${card.icon}"></i>
            </div>
            <div class="text-center mt-auto">
                <div class="text-[9px] text-gray-400 truncate">${card.title}</div>
                <div class="font-bold text-sm text-white truncate">${card.name}</div>
                <div class="mt-1 bg-black/30 rounded text-[10px] text-gray-300 font-mono">CP ${card.power}</div>
            </div>
        </div>
    `;
}

function getAttrIcon(type) {
    const map = { 'sci': 'fa-flask', 'his': 'fa-scroll', 'art': 'fa-palette', 'war': 'fa-meteor' };
    return map[type] || 'fa-star';
}
