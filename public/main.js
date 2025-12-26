import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, 
    query, orderBy, limit, getDocs, serverTimestamp, where, onSnapshot, runTransaction, 
    writeBatch
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
// 🃏 卡牌資料庫 (Card Database)
// ==========================================
const CARD_DB = [
    // SSR (5%)
    { 
        id: 'ssr_001', name: '愛因斯坦', title: '光之物理學家', rarity: 'SSR', type: 'sci', 
        power: 2500, hp: 3000, icon: 'fa-atom',
        skill: { name: "相對論衝擊", desc: "造成 1.5倍 攻擊傷害", type: "atk", val: 1.5 },
        subTrait: { name: "光速運算", desc: "主卡攻擊力 +15%", type: "buff_atk", val: 0.15 }
    },
    { 
        id: 'ssr_002', name: '秦始皇', title: '千古一帝', rarity: 'SSR', type: 'his', 
        power: 2400, hp: 3500, icon: 'fa-dragon',
        skill: { name: "萬里長城", desc: "回復 30% 最大生命", type: "heal", val: 0.3 },
        subTrait: { name: "帝王威嚴", desc: "主卡生命值 +20%", type: "buff_hp", val: 0.2 }
    },
    
    // SR (15%)
    { 
        id: 'sr_001', name: '拿破崙', title: '征服者', rarity: 'SR', type: 'war', 
        power: 1800, hp: 2500, icon: 'fa-person-rifle',
        skill: { name: "滑鐵盧砲擊", desc: "造成 1.3倍 攻擊傷害", type: "atk", val: 1.3 },
        subTrait: { name: "進軍", desc: "主卡攻擊力 +10%", type: "buff_atk", val: 0.1 }
    },
    { 
        id: 'sr_002', name: '居禮夫人', title: '放射之母', rarity: 'SR', type: 'sci', 
        power: 1750, hp: 2400, icon: 'fa-flask',
        skill: { name: "鐳射線", desc: "造成 1.2倍 傷害", type: "atk", val: 1.2 },
        subTrait: { name: "研究精神", desc: "主卡生命值 +10%", type: "buff_hp", val: 0.1 }
    },

    // R (30%)
    { id: 'r_001', name: '牛頓', title: '力學', rarity: 'R', type: 'sci', power: 1200, hp: 1800, icon: 'fa-apple-whole', skill: {name:"重力", desc:"1.1倍傷", type:"atk", val:1.1}, subTrait: {name:"力學", desc:"攻+5%", type:"buff_atk", val:0.05} },
    { id: 'r_002', name: '孔子', title: '至聖', rarity: 'R', type: 'his', power: 1150, hp: 2000, icon: 'fa-scroll', skill: {name:"教誨", desc:"回15%血", type:"heal", val:0.15}, subTrait: {name:"仁愛", desc:"血+8%", type:"buff_hp", val:0.08} },

    // N (50%)
    { id: 'n_001', name: '步兵', title: '士兵', rarity: 'N', type: 'war', power: 500, hp: 1000, icon: 'fa-person', skill: {name:"突刺", desc:"1倍傷", type:"atk", val:1.0}, subTrait: {name:"後勤", desc:"血+50", type:"buff_hp_flat", val:50} },
    { id: 'n_002', name: '弓手', title: '士兵', rarity: 'N', type: 'war', power: 450, hp: 900, icon: 'fa-bow-arrow', skill: {name:"射擊", desc:"1倍傷", type:"atk", val:1.0}, subTrait: {name:"支援", desc:"攻+20", type:"buff_atk_flat", val:20} },
];

const GACHA_RATES = { SSR: 0.05, SR: 0.20, R: 0.50 };

// 全域狀態
let currentUserData = null;
let quizBuffer = [];
const BUFFER_SIZE = 3;
let isFetchingQuiz = false;
let currentActiveQuiz = null; 
let currentLang = 'zh-TW';

// 對戰相關
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
        updateSettingsUI();
        renderHomeHero();
        switchToPage('page-home');
        fillQuizBuffer();

    } else {
        document.getElementById('login-screen').classList.remove('hidden');
    }
});

// ==========================================
// ⚔️ PVP 對戰系統 (Battle Logic)
// ==========================================

window.startPvpMatchmaking = async () => {
    if (!currentUserData.cardInventory.length) return alert("請先去召喚至少一張英靈！");
    
    switchToPage('page-battle-setup');
    selectedDeck = { main: null, sub: null };
    updateSetupUI();
};

window.openCardSelector = (slot) => {
    const modal = document.getElementById('selector-modal');
    const grid = document.getElementById('selector-grid');
    modal.classList.remove('hidden');
    grid.innerHTML = '';

    const cards = currentUserData.cardInventory.map(c => ({...c, data: CARD_DB.find(db => db.id === c.cardId)})).filter(c=>c.data);
    cards.sort((a, b) => b.data.power - a.data.power);

    cards.forEach(c => {
        const div = document.createElement('div');
        div.className = `card-frame rarity-${c.data.rarity} scale-90 cursor-pointer`;
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
    const cancelBtn = document.getElementById('btn-battle-cancel');
    const previewDiv = document.getElementById('setup-stats-preview');

    // 重置按鈕狀態
    btn.classList.remove('hidden');
    cancelBtn.classList.add('hidden');

    if (selectedDeck.main) {
        mainSlot.innerHTML = renderCardHTML(selectedDeck.main);
        mainSlot.classList.remove('border-dashed');
        mainSlot.className = `w-24 h-32 rounded-xl overflow-hidden shadow-lg border-2 rarity-${selectedDeck.main.rarity}`;
    }

    if (selectedDeck.sub) {
        subSlot.innerHTML = renderCardHTML(selectedDeck.sub);
        subSlot.classList.remove('border-dashed');
        subSlot.className = `w-24 h-32 rounded-xl overflow-hidden shadow-lg border-2 rarity-${selectedDeck.sub.rarity}`;
    }

    if (selectedDeck.main && selectedDeck.sub) {
        btn.disabled = false;
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
        previewDiv.classList.remove('hidden');

        let finalHp = selectedDeck.main.hp;
        let finalAtk = selectedDeck.main.power;
        const sub = selectedDeck.sub;

        if (sub.subTrait) {
            if (sub.subTrait.type === 'buff_hp') finalHp *= (1 + sub.subTrait.val);
            if (sub.subTrait.type === 'buff_atk') finalAtk *= (1 + sub.subTrait.val);
            if (sub.subTrait.type === 'buff_hp_flat') finalHp += sub.subTrait.val;
            if (sub.subTrait.type === 'buff_atk_flat') finalAtk += sub.subTrait.val;
        }

        document.getElementById('preview-hp').innerText = Math.floor(finalHp);
        document.getElementById('preview-atk').innerText = Math.floor(finalAtk);
        document.getElementById('preview-skills').innerHTML = `
            <div>⚔️ 主: ${selectedDeck.main.skill.name}</div>
            <div>🛡️ 副: ${selectedDeck.sub.subTrait.name}</div>
        `;
    }
}

window.confirmBattleDeck = async () => {
    const btn = document.getElementById('btn-battle-ready');
    const cancelBtn = document.getElementById('btn-battle-cancel');
    const previewDiv = document.getElementById('setup-stats-preview');
    
    // UI 切換為尋找狀態
    btn.classList.add('hidden');
    cancelBtn.classList.remove('hidden');
    
    // 顯示配對中狀態
    previewDiv.innerHTML = `
        <div class="text-center py-4">
            <div class="loader w-8 h-8 border-2 mx-auto mb-2"></div>
            <p class="text-sm text-blue-400 animate-pulse">🔍 搜尋對手中...</p>
            <p class="text-xs text-gray-500 mt-1">請稍候</p>
        </div>
    `;

    try {
        // 計算戰鬥數據
        const main = selectedDeck.main;
        const sub = selectedDeck.sub;
        let finalHp = main.hp;
        let finalAtk = main.power;

        if (sub.subTrait) {
            if (sub.subTrait.type === 'buff_hp') finalHp *= (1 + sub.subTrait.val);
            if (sub.subTrait.type === 'buff_atk') finalAtk *= (1 + sub.subTrait.val);
            if (sub.subTrait.type === 'buff_hp_flat') finalHp += sub.subTrait.val;
            if (sub.subTrait.type === 'buff_atk_flat') finalAtk += sub.subTrait.val;
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
            answer: null
        };

        // 先清理過期房間 (超過 2 分鐘且還在 waiting 的)
        const twoMinAgo = new Date(Date.now() - 120000);
        const expiredQuery = query(
            collection(db, "pvp_rooms"), 
            where("status", "==", "waiting"), 
            where("createdAt", "<", twoMinAgo)
        );
        const expiredSnap = await getDocs(expiredQuery);
        const batch = writeBatch(db);
        expiredSnap.forEach(doc => batch.delete(doc.ref));
        if (!expiredSnap.empty) await batch.commit();

        // 配對邏輯：尋找等待中的房間
        const waitingQuery = query(
            collection(db, "pvp_rooms"), 
            where("status", "==", "waiting"),
            where("createdAt", ">", twoMinAgo),
            limit(5) // 多抓幾個以防有自己的房間
        );
        const snapshot = await getDocs(waitingQuery);

        // 過濾掉自己創建的房間
        const availableRooms = snapshot.docs.filter(
            doc => doc.data().host.uid !== auth.currentUser.uid
        );

        if (availableRooms.length > 0) {
            // 找到對手的房間，加入
            const roomDoc = availableRooms[0];
            await updateDoc(doc(db, "pvp_rooms", roomDoc.id), {
                guest: myBattleData,
                status: "battle",
                turn: 1,
                attacker: Math.random() < 0.5 ? 'host' : 'guest'
            });
            currentRoomId = roomDoc.id;
            myBattleRole = 'guest';
            showToast('✅ 找到對手！', 'success');
            initBattleInterface();
            return;
        }

        // 沒有可用房間，創建新房間
        const docRef = await addDoc(collection(db, "pvp_rooms"), {
            host: myBattleData,
            guest: null,
            status: "waiting",
            createdAt: serverTimestamp(),
            turn: 1,
            expiresAt: new Date(Date.now() + 120000) // 2 分鐘後過期
        });
        currentRoomId = docRef.id;
        myBattleRole = 'host';
        
        showToast('🔍 等待對手加入...', 'info');

        // 設定超時機制 (90 秒後自動取消)
        const matchTimeout = setTimeout(() => {
            if (currentRoomId && myBattleRole === 'host') {
                showToast('⏰ 配對超時，已取消', 'warning');
                leaveBattle(true);
            }
        }, 90000);
        
        // 監聽房間狀態 (等待對手加入)
        battleUnsub = onSnapshot(doc(db, "pvp_rooms", currentRoomId), (docSnap) => {
            if (!docSnap.exists()) {
                clearTimeout(matchTimeout);
                return;
            }
            
            const data = docSnap.data();
            if (data.status === 'battle' && data.guest) {
                clearTimeout(matchTimeout);
                showToast('⚔️ 對手已加入！', 'success');
                initBattleInterface();
            }
        });

    } catch (error) {
        console.error("匹配失敗:", error);
        showToast('❌ 匹配失敗，請重試', 'error');
        leaveBattle(false);
    }
};

function initBattleInterface() {
    switchToPage('page-battle-arena');
    document.getElementById('battle-quiz-layer').classList.add('hidden');
    document.getElementById('battle-status-msg').innerText = "戰鬥開始!";
    document.getElementById('battle-damage-text').classList.add('hidden'); // 重置傷害文字
    
    updateBattleDisplay(null, 'my', {hp: selectedDeck.main.hp, maxHp: selectedDeck.main.hp}); 

    if (battleUnsub) battleUnsub(); // 先清除舊的等待監聽

    battleUnsub = onSnapshot(doc(db, "pvp_rooms", currentRoomId), async (docSnap) => {
        if (!docSnap.exists()) return;
        const room = docSnap.data();

        if (room.status === "battle") {
            const me = room[myBattleRole];
            const enemy = room[myBattleRole === 'host' ? 'guest' : 'host'];
            
            updateBattleDisplay(me, 'my');
            updateBattleDisplay(enemy, 'enemy');

            // 顯示當前先攻方
            const attackerName = room.attacker === myBattleRole ? "我方" : "敵方";
            const color = room.attacker === myBattleRole ? "text-green-400" : "text-red-400";
            document.getElementById('battle-status-msg').innerHTML = `第 ${room.turn} 回合<br><span class="text-sm text-gray-400">先攻: <span class="${color}">${attackerName}</span></span>`;

            // 顯示傷害特效 (如果有 Last Log)
            if (room.lastLog && room.lastLog.damage > 0) {
                 showDamagePopup(room.lastLog.damage);
            }

            if (me.hp <= 0 || enemy.hp <= 0) {
                endBattle(me.hp > 0);
                return;
            }

            if (!room.currentQuestion) {
                if (myBattleRole === 'host') await generateBattleQuestion(currentRoomId);
            } else if (me.answer === null) {
                showBattleQuestion(room.currentQuestion);
            } else if (me.answer !== null && enemy.answer === null) {
                document.getElementById('battle-quiz-layer').classList.add('hidden');
                document.getElementById('battle-status-msg').innerText = "等待對手作答...";
            } else if (me.answer !== null && enemy.answer !== null) {
                document.getElementById('battle-status-msg').innerText = "回合結算中...";
                if (myBattleRole === 'host') resolveTurn(room);
            }
        }
    });
}

// 離開戰鬥 / 取消配對
window.leaveBattle = async (navigate = true) => {
    if (battleUnsub) { 
        battleUnsub(); 
        battleUnsub = null; 
    }

    if (currentRoomId && myBattleRole === 'host') {
        try {
            const roomRef = doc(db, "pvp_rooms", currentRoomId);
            const snap = await getDoc(roomRef);
            if (snap.exists() && snap.data().status === 'waiting') {
                await deleteDoc(roomRef);
            }
        } catch (e) { console.error(e); }
    }

    currentRoomId = null;
    myBattleRole = null;
    
    // 重置按鈕
    const btn = document.getElementById('btn-battle-ready');
    const cancelBtn = document.getElementById('btn-battle-cancel');
    if(btn) {
        btn.classList.remove('hidden');
        btn.disabled = false;
        cancelBtn.classList.add('hidden');
    }

    if (navigate) switchToPage('page-home');
};

function updateBattleDisplay(data, side, fallback) {
    const info = data || fallback;
    if (!info) return;

    const hpPercent = (info.hp / info.maxHp) * 100;
    const bar = document.getElementById(`${side}-hp-bar`);
    bar.style.width = `${Math.max(0, hpPercent)}%`;
    
    if (hpPercent < 30) bar.className = "h-full bg-red-600 transition-all duration-500 animate-pulse";
    else bar.className = `h-full ${side==='my'?'bg-green-500':'bg-red-500'} transition-all duration-500`;

    document.getElementById(`${side}-hp-text`).innerText = `${Math.max(0, info.hp)}/${info.maxHp}`;
    if (data) {
        document.getElementById(`${side}-name`).innerText = data.name;
        const mainDiv = document.getElementById(`${side}-card-main`);
        if(mainDiv.innerHTML === "") {
            mainDiv.innerHTML = `<i class="fa-solid ${data.mainCard.icon} text-2xl text-white/50 flex items-center justify-center h-full"></i>`;
            mainDiv.className = `w-12 h-16 rounded border-2 rarity-${data.mainCard.rarity} bg-slate-800`;
        }
    }
}

function showDamagePopup(dmg) {
    const el = document.getElementById('battle-damage-text');
    el.innerText = `-${dmg}`;
    el.classList.remove('hidden', 'damage-popup');
    void el.offsetWidth; // trigger reflow
    el.classList.add('damage-popup');
}

async function generateBattleQuestion(roomId) {
    let q = null;
    if (quizBuffer.length > 0) q = quizBuffer.shift();
    else {
        await fetchOneQuestion(); 
        q = quizBuffer.shift();
    }
    fillQuizBuffer(); 
    await updateDoc(doc(db, "pvp_rooms", roomId), { currentQuestion: q, lastLog: null });
}

function showBattleQuestion(q) {
    document.getElementById('battle-quiz-layer').classList.remove('hidden');
    document.getElementById('battle-q-text').innerText = q.q;
    const container = document.getElementById('battle-options');
    container.innerHTML = '';
    
    q.options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = "w-full text-left p-4 bg-slate-700 hover:bg-slate-600 rounded-xl border border-slate-600 mb-2 font-bold";
        btn.innerText = opt;
        btn.onclick = () => submitBattleAnswer(opt === q.correct);
        container.appendChild(btn);
    });
}

async function submitBattleAnswer(isCorrect) {
    document.getElementById('battle-quiz-layer').classList.add('hidden');
    await updateDoc(doc(db, "pvp_rooms", currentRoomId), {
        [`${myBattleRole}.answer`]: isCorrect ? 'correct' : 'wrong'
    });
}

// Host 負責結算邏輯
async function resolveTurn(room) {
    const host = room.host;
    const guest = room.guest;
    
    // 1. 決定攻擊順序 (先攻者先結算)
    // room.attacker 記錄的是這一回合誰先攻
    const firstRole = room.attacker;
    const secondRole = room.attacker === 'host' ? 'guest' : 'host';

    const first = room[firstRole];
    const second = room[secondRole];

    let newHostHp = host.hp;
    let newGuestHp = guest.hp;
    
    // 用來記錄最後一次造成的傷害，讓前端顯示跳字
    let lastDamageDealt = 0; 
    let logMsg = "";

    // --- 內部小函式：計算單次行動的結果 ---
    const calculateAction = (attacker, roleIsHost) => {
        let dmg = 0;
        let heal = 0;
        
        const skill = attacker.mainCard.skill;
        const skillType = skill.type; // 'atk', 'heal', 'mix'
        const skillVal = skill.val;   // 倍率

        // A. 計算傷害 (攻擊型 或 混合型)
        if (skillType === 'atk' || skillType === 'mix') {
            const multiplier = skillVal;
            dmg = Math.floor(attacker.atk * multiplier);
        } else {
            // 純補師普攻 (無倍率)
            dmg = attacker.atk;
        }

        // B. 計算回復 (回復型 或 混合型)
        if (skillType === 'heal' || skillType === 'mix') {
            // 如果是混合型(mix)，回復量固定為 10% (0.1)，否則使用 skillVal
            const healRate = (skillType === 'mix') ? 0.1 : skillVal;
            heal = Math.floor(attacker.maxHp * healRate);
        }

        return { dmg, heal };
    };

    // --- 第一順位行動 ---
    if (first.answer === 'correct') {
        const action = calculateAction(first, firstRole === 'host');
        
        // 1. 造成傷害 (扣對手的血)
        if (firstRole === 'host') newGuestHp -= action.dmg;
        else newHostHp -= action.dmg;
        
        // 2. 自身回復 (加自己的血，不能超過上限)
        if (action.heal > 0) {
            if (firstRole === 'host') newHostHp = Math.min(host.maxHp, newHostHp + action.heal);
            else newGuestHp = Math.min(guest.maxHp, newGuestHp + action.heal);
        }

        lastDamageDealt = action.dmg;
        logMsg += `${first.name} 發動技能！造成 ${action.dmg} 傷害。\n`;
    } else {
        logMsg += `${first.name} 答錯了，錯失良機。\n`;
    }

    // --- 第二順位行動 (反擊) ---
    // ⚠️ 只有在雙方都還活著的情況下，後手才能反擊
    if (newHostHp > 0 && newGuestHp > 0) {
        if (second.answer === 'correct') {
            const action = calculateAction(second, secondRole === 'host');

            // 1. 造成傷害
            if (secondRole === 'host') newGuestHp -= action.dmg;
            else newHostHp -= action.dmg;

            // 2. 自身回復
            if (action.heal > 0) {
                if (secondRole === 'host') newHostHp = Math.min(host.maxHp, newHostHp + action.heal);
                else newGuestHp = Math.min(guest.maxHp, newGuestHp + action.heal);
            }

            // 更新最後傷害顯示 (或者你可以選擇累加，這裡為了顯示反擊效果，覆蓋為反擊傷害)
            if (action.dmg > 0) lastDamageDealt = action.dmg;
            
            logMsg += `${second.name} 反擊！造成 ${action.dmg} 傷害。`;
        } else {
            logMsg += `${second.name} 答錯了。`;
        }
    }

    // --- 延遲更新資料庫 (讓前端動畫跑一下) ---
    setTimeout(async () => {
        try {
            await updateDoc(doc(db, "pvp_rooms", currentRoomId), {
                "host.hp": newHostHp,
                "guest.hp": newGuestHp,
                "host.answer": null,
                "guest.answer": null,
                currentQuestion: null,
                turn: room.turn + 1,
                attacker: secondRole, // 交換下一回合先攻
                lastLog: { 
                    message: logMsg,
                    damage: lastDamageDealt // 傳給前端顯示紅色跳字
                }
            });
        } catch (e) {
            console.error("結算更新失敗:", e);
        }
    }, 1500);
}

function endBattle(isWin) {
    if (battleUnsub) battleUnsub();
    alert(isWin ? "戰鬥勝利！獲得 100 G" : "戰鬥失敗...");
    if (isWin) {
        const newGold = currentUserData.gold + 100;
        updateDoc(doc(db, "users", auth.currentUser.uid), { gold: newGold });
    }
    switchToPage('page-home');
    if (myBattleRole === 'host') deleteDoc(doc(db, "pvp_rooms", currentRoomId));
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
        quizBuffer = []; 
        fillQuizBuffer();
        alert("設定已更新！");
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
    // 離開對戰頁面時的防護
    const isBattlePage = (pageId === 'page-battle-setup' || pageId === 'page-battle-arena');
    if (currentRoomId && !isBattlePage) {
        leaveBattle(false);
    }

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

function getNextSubject() {
    const s = currentUserData.settings || {};
    const weakList = s.weak ? s.weak.split(/[,，\s]+/).filter(v=>v) : [];
    const strongList = s.strong ? s.strong.split(/[,，\s]+/).filter(v=>v) : [];
    const fallback = ["歷史", "科學", "地理", "常識", "科技"];

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

// 瀏覽器關閉/重整時的防護
window.addEventListener('beforeunload', (e) => {
    if (currentRoomId) {
        if (myBattleRole === 'host') {
            e.preventDefault();
            e.returnValue = ''; 
        }
    }
});
