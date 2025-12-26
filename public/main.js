import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, 
    query, orderBy, limit, getDocs, serverTimestamp, where, onSnapshot, runTransaction 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Firebase Config
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
// 🃏 卡牌資料庫 (新增技能與特性)
// ==========================================
const CARD_DB = [
    // SSR
    { id: 'ssr_001', name: '愛因斯坦', rarity: 'SSR', type: 'sci', power: 2500, hp: 3000, icon: 'fa-atom', 
      skill: { name: "相對論衝擊", desc: "造成 1.5倍 傷害", type: "atk", val: 1.5 },
      subTrait: { name: "光速運算", desc: "主卡攻擊 +10%", type: "buff_atk", val: 0.1 } 
    },
    { id: 'ssr_002', name: '秦始皇', rarity: 'SSR', type: 'his', power: 2400, hp: 3500, icon: 'fa-dragon',
      skill: { name: "萬里長城", desc: "恢復 20% 生命", type: "heal", val: 0.2 },
      subTrait: { name: "帝王威嚴", desc: "主卡生命 +10%", type: "buff_hp", val: 0.1 }
    },
    { id: 'ssr_003', name: '達文西', rarity: 'SSR', type: 'art', power: 2350, hp: 3200, icon: 'fa-palette',
      skill: { name: "文藝復興", desc: "造成 1.2倍 傷害並恢復 10% 生命", type: "mix", val: 1.2 },
      subTrait: { name: "黃金比例", desc: "主卡攻擊 +8%", type: "buff_atk", val: 0.08 }
    },
    
    // SR
    { id: 'sr_001', name: '拿破崙', rarity: 'SR', type: 'war', power: 1800, hp: 2500, icon: 'fa-person-rifle',
      skill: { name: "滑鐵盧砲擊", desc: "造成 1.3倍 傷害", type: "atk", val: 1.3 },
      subTrait: { name: "進軍", desc: "主卡攻擊 +5%", type: "buff_atk", val: 0.05 }
    },
    
    // N
    { id: 'n_001', name: '步兵', rarity: 'N', type: 'war', power: 500, hp: 1000, icon: 'fa-person',
      skill: { name: "突刺", desc: "造成 1.1倍 傷害", type: "atk", val: 1.1 },
      subTrait: { name: "後勤", desc: "主卡生命 +200", type: "buff_hp_flat", val: 200 }
    },
];

const GACHA_RATES = { SSR: 0.05, SR: 0.20, R: 0.50 };

// 狀態變數
let currentUserData = null;
let quizBuffer = [];
let currentActiveQuiz = null;
const BUFFER_SIZE = 3;
let isFetchingQuiz = false;
let currentLang = 'zh-TW';

// 對戰相關變數
let battleUnsub = null;
let currentRoomId = null;
let myBattleRole = null; // 'host' or 'guest'
let selectedDeck = { main: null, sub: null };

// ==========================================
// 🚀 Auth & Init
// ==========================================
window.googleLogin = () => signInWithPopup(auth, provider).catch(e => alert(e.message));
window.logout = () => signOut(auth).then(() => location.reload());

onAuthStateChanged(auth, async (user) => {
    if (user) {
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('bottom-nav').classList.remove('hidden');
        
        const userRef = doc(db, "users", user.uid);
        const docSnap = await getDoc(userRef);
        
        if (docSnap.exists()) {
            currentUserData = docSnap.data();
            if (!currentUserData.cardInventory) currentUserData.cardInventory = [];
            if (!currentUserData.gold) currentUserData.gold = 500;
        } else {
            currentUserData = {
                uid: user.uid,
                displayName: user.displayName,
                email: user.email,
                gold: 500, 
                cardInventory: [], 
                totalPower: 0,
                settings: { level: '國中' },
                createdAt: serverTimestamp()
            };
            await setDoc(userRef, currentUserData);
        }

        updateUIHeader();
        renderHomeHero();
        switchToPage('page-home');
        fillQuizBuffer();

    } else {
        document.getElementById('login-screen').classList.remove('hidden');
    }
});

// ==========================================
// ⚔️ PVP 對戰系統 (核心邏輯)
// ==========================================

// 1. 開始配對
window.startPvpMatchmaking = async () => {
    if (!currentUserData.cardInventory.length) return alert("請先去召喚至少一張英靈！");
    
    switchToPage('page-battle-setup');
    // 重置選卡狀態
    selectedDeck = { main: null, sub: null };
    updateSetupUI();
};

// 2. 選擇牌組介面邏輯
window.openCardSelector = (slot) => {
    const modal = document.getElementById('selector-modal');
    const grid = document.getElementById('selector-grid');
    modal.classList.remove('hidden');
    grid.innerHTML = '';

    // 顯示擁有的卡片
    const cards = currentUserData.cardInventory.map(c => ({...c, data: CARD_DB.find(db => db.id === c.cardId)}));
    
    cards.forEach(c => {
        const div = document.createElement('div');
        div.className = `card-frame rarity-${c.data.rarity} scale-90`;
        div.innerHTML = renderCardHTML(c.data);
        div.onclick = () => {
            selectedDeck[slot] = c.data;
            updateSetupUI();
            modal.classList.add('hidden');
        };
        grid.appendChild(div);
    });
};

function updateSetupUI() {
    const mainSlot = document.getElementById('setup-slot-main');
    const subSlot = document.getElementById('setup-slot-sub');
    const btn = document.getElementById('btn-battle-ready');

    if (selectedDeck.main) {
        mainSlot.innerHTML = renderCardHTML(selectedDeck.main);
        mainSlot.classList.add('filled', `rarity-${selectedDeck.main.rarity}`);
    }
    if (selectedDeck.sub) {
        subSlot.innerHTML = renderCardHTML(selectedDeck.sub);
        subSlot.classList.add('filled', `rarity-${selectedDeck.sub.rarity}`);
    }

    if (selectedDeck.main && selectedDeck.sub) {
        btn.disabled = false;
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
}

// 3. 確認牌組並尋找房間
window.confirmBattleDeck = async () => {
    const btn = document.getElementById('btn-battle-ready');
    btn.innerText = "尋找對手中...";
    btn.disabled = true;

    // 計算最終屬性 (主卡 + 副卡特性)
    const main = selectedDeck.main;
    const sub = selectedDeck.sub;
    
    let finalHp = main.hp;
    let finalAtk = main.power; // 這裡用 power 當攻擊力

    // 應用副卡特性
    if (sub.subTrait) {
        if (sub.subTrait.type === 'buff_hp') finalHp *= (1 + sub.subTrait.val);
        if (sub.subTrait.type === 'buff_atk') finalAtk *= (1 + sub.subTrait.val);
        if (sub.subTrait.type === 'buff_hp_flat') finalHp += sub.subTrait.val;
    }

    const myBattleData = {
        uid: auth.currentUser.uid,
        name: currentUserData.displayName,
        avatar: currentUserData.equipped?.avatar || '',
        hp: Math.floor(finalHp),
        maxHp: Math.floor(finalHp),
        atk: Math.floor(finalAtk),
        mainCard: main,
        subCard: sub,
        ready: true,
        answer: null // 'correct', 'wrong', null
    };

    // 簡單配對：找一個 waiting 的房間，沒有就創
    const twoMinAgo = new Date(Date.now() - 120000);
    const q = query(collection(db, "pvp_rooms"), where("status", "==", "waiting"), where("createdAt", ">", twoMinAgo), limit(1));
    const snapshot = await getDocs(q);

    if (!snapshot.empty) {
        // 加入現有房間
        const roomDoc = snapshot.docs[0];
        if (roomDoc.data().host.uid !== auth.currentUser.uid) { // 避免自己撞自己
            await updateDoc(doc(db, "pvp_rooms", roomDoc.id), {
                guest: myBattleData,
                status: "battle",
                turn: 1,
                attacker: Math.random() < 0.5 ? 'host' : 'guest' // 隨機先攻
            });
            currentRoomId = roomDoc.id;
            myBattleRole = 'guest';
            initBattleInterface();
            return;
        }
    }

    // 創建新房間
    const docRef = await addDoc(collection(db, "pvp_rooms"), {
        host: myBattleData,
        guest: null,
        status: "waiting",
        createdAt: serverTimestamp(),
        turn: 1,
        logs: []
    });
    currentRoomId = docRef.id;
    myBattleRole = 'host';
    initBattleInterface();
};

// 4. 戰鬥介面初始化與監聽
function initBattleInterface() {
    switchToPage('page-battle-arena');
    document.getElementById('battle-layer').classList.remove('hidden');
    document.getElementById('battle-status-msg').innerText = "等待對手...";
    
    // 渲染我方資訊
    updateBattleDisplay({ hp: selectedDeck.main.hp, maxHp: selectedDeck.main.hp }, 'my'); // 初始顯示
    
    // 監聽房間
    battleUnsub = onSnapshot(doc(db, "pvp_rooms", currentRoomId), async (docSnap) => {
        if (!docSnap.exists()) return;
        const room = docSnap.data();

        // 雙方都到齊
        if (room.status === "battle") {
            const me = room[myBattleRole];
            const enemy = room[myBattleRole === 'host' ? 'guest' : 'host'];
            
            // 更新雙方血量 UI
            updateBattleDisplay(me, 'my');
            updateBattleDisplay(enemy, 'enemy');

            // 判斷勝負
            if (me.hp <= 0 || enemy.hp <= 0) {
                endBattle(me.hp > 0);
                return;
            }

            // 流程控制 (Host 負責發題與結算，Guest 負責聽)
            // 階段 1: 答題階段 (還沒有題目或題目已過期)
            if (!room.currentQuestion) {
                document.getElementById('battle-status-msg').innerText = `第 ${room.turn} 回合：準備答題`;
                if (myBattleRole === 'host') {
                    // Host 產生題目
                    await generateBattleQuestion(currentRoomId);
                }
            } else if (room.currentQuestion && me.answer === null) {
                // 階段 2: 顯示題目 (如果我還沒答)
                showBattleQuestion(room.currentQuestion);
            } else if (me.answer !== null && enemy.answer === null) {
                // 階段 3: 等待對手
                document.getElementById('battle-quiz-box').classList.add('hidden');
                document.getElementById('battle-status-msg').innerText = "等待對手作答...";
            } else if (me.answer !== null && enemy.answer !== null) {
                // 階段 4: 雙方都答完，顯示結算動畫 (Host 負責計算數據)
                document.getElementById('battle-status-msg').innerText = "回合結算中...";
                if (myBattleRole === 'host') {
                    resolveTurn(room);
                }
            }
        }
    });
}

function updateBattleDisplay(data, side) {
    if (!data) return;
    const hpPercent = (data.hp / data.maxHp) * 100;
    document.getElementById(`${side}-hp-bar`).style.width = `${Math.max(0, hpPercent)}%`;
    document.getElementById(`${side}-hp-text`).innerText = `${Math.max(0, data.hp)}/${data.maxHp}`;
    document.getElementById(`${side}-name`).innerText = data.name;
    
    // 只在第一次渲染卡牌圖示
    const mainDiv = document.getElementById(`${side}-card-main`);
    if (!mainDiv.innerHTML && data.mainCard) {
        mainDiv.innerHTML = `<i class="fa-solid ${data.mainCard.icon} text-2xl text-white flex justify-center items-center h-full"></i>`;
        if (side === 'my') {
            document.getElementById('my-skill-tooltip').innerText = `技能：${data.mainCard.skill.name}\n${data.mainCard.skill.desc}`;
        }
    }
}

// 產生共用題目
async function generateBattleQuestion(roomId) {
    // 這裡為了速度，直接從本地 Buffer 拿，如果沒有就 call API (簡化版)
    let q = null;
    if (quizBuffer.length > 0) q = quizBuffer.shift();
    else {
        await fetchOneQuestion(); // 強制抓
        q = quizBuffer.shift();
    }
    fillQuizBuffer(); // 補貨

    await updateDoc(doc(db, "pvp_rooms", roomId), {
        currentQuestion: q
    });
}

function showBattleQuestion(q) {
    document.getElementById('battle-status-msg').innerText = "";
    document.getElementById('battle-quiz-box').classList.remove('hidden');
    document.getElementById('battle-q-text').innerText = q.q;
    
    const container = document.getElementById('battle-options');
    container.innerHTML = '';
    q.options.forEach((opt, idx) => {
        const btn = document.createElement('button');
        btn.className = "w-full text-left p-3 bg-slate-700 hover:bg-slate-600 rounded border border-slate-500 mb-2";
        btn.innerText = opt;
        btn.onclick = () => submitBattleAnswer(opt === q.correct);
        container.appendChild(btn);
    });
}

async function submitBattleAnswer(isCorrect) {
    // 隱藏題目
    document.getElementById('battle-quiz-box').classList.add('hidden');
    document.getElementById('battle-status-msg').innerText = "上傳答案中...";
    
    const updateData = {};
    updateData[`${myBattleRole}.answer`] = isCorrect ? 'correct' : 'wrong';
    
    await updateDoc(doc(db, "pvp_rooms", currentRoomId), updateData);
}

// 回合結算 (Host Only)
async function resolveTurn(room) {
    const host = room.host;
    const guest = room.guest;
    
    // 1. 決定攻擊順序 (先攻者先結算)
    const first = room.attacker === 'host' ? host : guest;
    const second = room.attacker === 'host' ? guest : host;
    const firstRole = room.attacker;
    const secondRole = room.attacker === 'host' ? 'guest' : 'host';

    let logMsg = "";
    let newHostHp = host.hp;
    let newGuestHp = guest.hp;

    // 先攻者攻擊
    if (first.answer === 'correct') {
        const dmg = calculateDamage(first);
        if (firstRole === 'host') newGuestHp -= dmg;
        else newHostHp -= dmg;
        logMsg += `${first.name} 發動攻擊！造成 ${dmg} 傷害。\n`;
    } else {
        logMsg += `${first.name} 答錯了，錯失良機。\n`;
    }

    // 若後手還活著，換後手攻擊
    if (newHostHp > 0 && newGuestHp > 0) {
        if (second.answer === 'correct') {
            const dmg = calculateDamage(second);
            if (secondRole === 'host') newGuestHp -= dmg;
            else newHostHp -= dmg;
            logMsg += `${second.name} 反擊！造成 ${dmg} 傷害。`;
        } else {
            logMsg += `${second.name} 答錯了。`;
        }
    }

    // 2. 清除答案，換下一回合，交換先攻
    // 這裡需要延遲一下讓前端有時間看動畫 (我們簡化直接更新)
    setTimeout(async () => {
        await updateDoc(doc(db, "pvp_rooms", currentRoomId), {
            "host.hp": newHostHp,
            "guest.hp": newGuestHp,
            "host.answer": null,
            "guest.answer": null,
            currentQuestion: null,
            turn: room.turn + 1,
            attacker: room.attacker === 'host' ? 'guest' : 'host', // 交換先攻
            lastLog: logMsg
        });
    }, 2000);
}

function calculateDamage(playerData) {
    let dmg = playerData.atk;
    // 技能發動 (簡單版：答對必定發動技能)
    const skill = playerData.mainCard.skill;
    if (skill.type === 'atk' || skill.type === 'mix') {
        dmg = Math.floor(dmg * skill.val);
    }
    // 這裡可以加入暴擊運算
    return dmg;
}

function endBattle(isWin) {
    if (battleUnsub) battleUnsub();
    
    alert(isWin ? "戰鬥勝利！獲得 100 G" : "戰鬥失敗...");
    
    if (isWin) {
        const newGold = currentUserData.gold + 100;
        currentUserData.gold = newGold;
        updateDoc(doc(db, "users", auth.currentUser.uid), { gold: newGold });
    }
    
    switchToPage('page-home');
    // 清理房間 (Host負責)
    if (myBattleRole === 'host') {
        deleteDoc(doc(db, "pvp_rooms", currentRoomId));
    }
}

// ==========================================
// ⚙️ 設定 (Settings)
// ==========================================
window.updateSettingsUI = () => {
    if (!currentUserData || !currentUserData.settings) return;
    const s = currentUserData.settings;
    document.getElementById('set-level').value = s.level || '國中';
    document.getElementById('set-strong').value = s.strong || '';
    document.getElementById('set-weak').value = s.weak || '';
    document.getElementById('set-source').value = s.source || 'ai';
};

window.saveSettings = async () => {
    if (!auth.currentUser) return;
    
    const newSettings = {
        level: document.getElementById('set-level').value,
        strong: document.getElementById('set-strong').value,
        weak: document.getElementById('set-weak').value,
        source: document.getElementById('set-source').value
    };

    const btn = document.querySelector('button[onclick="saveSettings()"]');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<div class="loader w-4 h-4 border-2"></div> 保存中...';
    btn.disabled = true;

    try {
        await updateDoc(doc(db, "users", auth.currentUser.uid), { settings: newSettings });
        currentUserData.settings = newSettings;
        
        // 清空舊緩衝，因為題目設定變了
        quizBuffer = []; 
        fillQuizBuffer();
        
        alert("設定已更新！接下來的討伐將套用新設定。");
    } catch (e) {
        console.error(e);
        alert("保存失敗");
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

// ==========================================
// 🏠 UI & Navigation
// ==========================================
function updateUIHeader() {
    if (!currentUserData) return;
    
    const cards = currentUserData.cardInventory.map(c => CARD_DB.find(db => db.id === c.cardId)).filter(Boolean);
    cards.sort((a, b) => b.power - a.power);
    const topPower = cards.slice(0, 5).reduce((sum, c) => sum + c.power, 0);
    
    currentUserData.totalPower = topPower; 

    document.getElementById('header-name').innerText = currentUserData.displayName;
    document.getElementById('header-gold').innerText = currentUserData.gold;
    document.getElementById('header-power').innerText = topPower;
    const level = Math.floor(topPower / 1000) + 1;
    document.getElementById('header-level').innerText = level;
}

function renderHomeHero() {
    const container = document.getElementById('home-hero-display');
    if (!currentUserData.cardInventory || currentUserData.cardInventory.length === 0) {
        container.innerHTML = `
            <div class="text-center text-gray-500 animate-pulse">
                <i class="fa-solid fa-ghost text-6xl mb-4 opacity-50"></i>
                <p class="text-xs">尚無契約英靈</p>
                <p class="text-[10px] mt-2">快去召喚吧！</p>
            </div>`;
        container.className = "relative w-64 h-96 bg-slate-800/50 border border-slate-600 rounded-xl flex items-center justify-center text-slate-500";
        return;
    }

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
    
    if (currentActiveQuiz) {
        renderQuizToDOM(currentActiveQuiz);
        return;
    }
    
    if (quizBuffer.length === 0) {
        document.getElementById('quiz-loading').classList.remove('hidden');
        document.getElementById('quiz-container').classList.add('hidden');
        document.getElementById('quiz-error-msg').classList.add('hidden');
        
        const success = await fetchOneQuestion(); 
        if (!success) {
            document.getElementById('quiz-error-msg').classList.remove('hidden');
            setTimeout(() => switchToPage('page-home'), 2000);
            return;
        }
    }
    renderNextQuestion();
};

// 決定下一個題目主題
function getNextSubject() {
    const s = currentUserData.settings || {};
    const weakList = s.weak ? s.weak.split(/[,，\s]+/).filter(v=>v) : [];
    const strongList = s.strong ? s.strong.split(/[,，\s]+/).filter(v=>v) : [];
    const fallback = ["歷史", "科學", "地理", "常識", "科技"];

    // 60% 機率出弱項，30% 機率出強項，10% 隨機
    const rand = Math.random();
    if (weakList.length > 0 && rand < 0.6) {
        return weakList[Math.floor(Math.random() * weakList.length)];
    } else if (strongList.length > 0 && rand < 0.9) {
        return strongList[Math.floor(Math.random() * strongList.length)];
    } else {
        return fallback[Math.floor(Math.random() * fallback.length)];
    }
}

async function fetchOneQuestion() {
    isFetchingQuiz = true;
    const settings = currentUserData.settings || {};
    const targetSubject = getNextSubject();
    
    try {
        const response = await fetch('/api/generate-quiz', {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                subject: targetSubject, 
                level: settings.level || "國中", 
                rank: "Adventurer", 
                difficulty: "medium",
                language: currentLang 
            })
        });
        
        if (!response.ok) throw new Error("Server Error");

        const data = await response.json();
        let aiText = data.text.replace(/```json/g, '').replace(/```/g, '').trim();
        const quizData = JSON.parse(aiText);
        
        let options = [quizData.correct, ...quizData.wrong];
        options.sort(() => Math.random() - 0.5);
        
        // 加上主題標籤，方便顯示
        quizBuffer.push({ ...quizData, options, subject: targetSubject });
        return true;
    } catch (e) {
        console.error("Fetch Quiz Error:", e);
        return false;
    } finally {
        isFetchingQuiz = false;
    }
}

async function fillQuizBuffer() {
    if (isFetchingQuiz) return;
    if (quizBuffer.length < BUFFER_SIZE) {
        await fetchOneQuestion();
    }
}

function renderNextQuestion() {
    if (quizBuffer.length === 0) return;

    currentActiveQuiz = quizBuffer.shift();
    fillQuizBuffer(); 
    renderQuizToDOM(currentActiveQuiz);
}

function renderQuizToDOM(quiz) {
    document.getElementById('quiz-loading').classList.add('hidden');
    document.getElementById('quiz-container').classList.remove('hidden');
    document.getElementById('quiz-feedback').classList.add('hidden');

    document.getElementById('question-text').innerText = quiz.q;
    // document.getElementById('quiz-target-subject').innerText = `目標：${quiz.subject || '未知領域'}`;
    
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
    if (quizBuffer.length > 0) {
        renderNextQuestion();
    } else {
        startAdventure(); // 重新觸發載入
    }
};

window.giveUpQuiz = () => {
    if(confirm("確定要撤退嗎？這題將會被跳過。")) {
        currentActiveQuiz = null;
        switchToPage('page-home');
    }
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

        currentUserData.gold = newGold;
        currentUserData.cardInventory = updatedDeck;
        updateUIHeader();

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
            el.style.animationDelay = `${idx * 0.15}s`;
            el.innerHTML = renderCardHTML(cardData);
            container.appendChild(el);
        });
    }, 1200);
}

window.closeGachaResult = () => {
    document.getElementById('gacha-result-overlay').classList.add('hidden');
    if (document.getElementById('page-gacha').classList.contains('hidden')) {
        updateUIHeader();
    }
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
