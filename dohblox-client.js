    let audioCtx = null;
    let playerHealth = 100;

    let activeEquippedWeapon = null;
    let inGameHotbar = Array(10).fill(null);
    let currentSelectedSlotIndex = 0;
    let isAttacking = false;
    let attackSwingTimer = 0;
    let equippedWeaponMesh = null;
    let winningPlatformRef = null;
    let gameLaunchTimeout = null;
    let loadingStepTimeouts = [];

    // CROSSROADS COMBAT STATE
    let crossroadsProjectiles = [];
    let crossroadsWalls = [];
    let crossroadsBombs = [];
    let crossroadsEffects = [];
    let crossroadsLastUseTimes = Object.create(null);
    const CROSSROADS_COOLDOWNS = {
        sword: 420,
        linked_sword: 420,
        rocket_launcher: 2500,
        timebomb: 5000,
        slingshot: 420,
        trowel: 3000
    };
    let crossroadsCooldownUiTimer = null;
    let crossroadsCombatLastTime = performance.now();
    let crossroadsRespawning = false;
    let crossroadsObjectCounter = 0;

    // DOHBLOX HQ DESTRUCTION / RESET STATE
    let hqWorldGroup = null;
    let hqDestructibles = [];
    let hqColliderRefs = [];
    let hqResetTimer = null;
    let hqLastResetAt = 0;
    const DOHBLOX_HQ_RESET_MS = 10 * 60 * 1000;

    // CHAT EMOTES + BOOMBOX STATE
    let localDanceUntil = 0;
    let boomboxPlaying = false;
    let boomboxStep = 0;
    let boomboxTimer = null;


    // PC MOUSE CONTROL VARIABLES
    let isMouseDownForCamera = false;
    let lastMousePos = { x: 0, y: 0 };

    // THREE.JS ENGINE VARS
    let gameScene, gameCamera, gameRenderer;
    let activeGameTitle = null;


    // MULTIPLAYER REAL-TIME NETWORKING (FIRESTORE ACROSS DEVICES + BROADCASTCHANNEL FALLBACK)
    let multiChannel = null;
    let localSessionId = 'sess_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    let remotePlayers = {}; // sessionId -> live remote player
    let heartbeatTimer = null;
    let localChatBubble = null;
    let localSpawnShieldUntil = 0;
    let cloudRoomPlayersUnsub = null;
    let cloudRoomEventsUnsub = null;
    let cloudRoomRef = null;
    let cloudRoomId = null;
    let cloudRoomJoinedAt = 0;
    let cloudSeenEventIds = new Set();
    let cloudRoomActive = false;

    function createPlayerNameTag(username) {
        const container = document.getElementById('world-chat-bubbles-container');
        if (!container) return null;
        const el = document.createElement('div');
        el.className = 'player-name-tag';
        el.innerText = username || 'Player';
        container.appendChild(el);
        return el;
    }

    function addSpawnShieldToAvatar(avatar, durationMs = 4500) {
        if (!avatar) return;
        const old = avatar.getObjectByName('__dohbloxSpawnShield');
        if (old && old.parent) old.parent.remove(old);

        const group = new THREE.Group();
        group.name = '__dohbloxSpawnShield';

        const shell = new THREE.Mesh(
            new THREE.SphereGeometry(2.15, 24, 18),
            new THREE.MeshBasicMaterial({
                color: 0x3aa8ff,
                transparent: true,
                opacity: 0.22,
                side: THREE.DoubleSide,
                depthWrite: false
            })
        );
        shell.position.y = 1.45;

        const wire = new THREE.Mesh(
            new THREE.SphereGeometry(2.2, 16, 12),
            new THREE.MeshBasicMaterial({
                color: 0x66c7ff,
                transparent: true,
                opacity: 0.34,
                wireframe: true,
                depthWrite: false
            })
        );
        wire.position.y = 1.45;

        group.add(shell, wire);
        avatar.add(group);

        const removeShield = () => {
            if (group.parent) group.parent.remove(group);
            shell.geometry.dispose();
            shell.material.dispose();
            wire.geometry.dispose();
            wire.material.dispose();
        };
        setTimeout(removeShield, Math.max(500, durationMs));
    }

    function activateLocalSpawnShield(durationMs = 4500, broadcast = true) {
        localSpawnShieldUntil = Date.now() + Math.max(500, durationMs);
        addSpawnShieldToAvatar(currentGameAvatar, durationMs);
        if (broadcast && activeGameTitle) {
            sendNetworkMessage('SPAWN_SHIELD', { durationMs: durationMs });
        }
    }

    // AUDIO SYNTHESIS SOUND EFFECTS
    function initAudioContext() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    function playBadgeSound() {
        if (!audioCtx) return;
        try {
            const now = audioCtx.currentTime;
            const osc1 = audioCtx.createOscillator();
            const osc2 = audioCtx.createOscillator();
            const gain = audioCtx.createGain();

            osc1.type = 'sine';
            osc2.type = 'triangle';

            osc1.frequency.setValueAtTime(523.25, now);
            osc1.frequency.setValueAtTime(659.25, now + 0.12);
            osc1.frequency.setValueAtTime(783.99, now + 0.24);
            osc1.frequency.setValueAtTime(1046.50, now + 0.36);

            osc2.frequency.setValueAtTime(261.63, now);
            osc2.frequency.setValueAtTime(329.63, now + 0.12);
            osc2.frequency.setValueAtTime(392.00, now + 0.24);
            osc2.frequency.setValueAtTime(523.25, now + 0.36);

            gain.gain.setValueAtTime(0.25, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

            osc1.connect(gain);
            osc2.connect(gain);
            gain.connect(audioCtx.destination);

            osc1.start(now);
            osc2.start(now);
            osc1.stop(now + 0.8);
            osc2.stop(now + 0.8);
        } catch(e) {}
    }

    function playJumpSound() {
        if (!audioCtx) return;
        try {
            const now = audioCtx.currentTime;
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(160, now);
            osc.frequency.exponentialRampToValueAtTime(380, now + 0.15);
            gain.gain.setValueAtTime(0.12, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now);
            osc.stop(now + 0.15);
        } catch(e) {}
    }

    function playSwingSound() {
        if (!audioCtx) return;
        try {
            const now = audioCtx.currentTime;
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(400, now);
            osc.frequency.exponentialRampToValueAtTime(80, now + 0.12);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now);
            osc.stop(now + 0.12);
        } catch(e) {}
    }

    function playExplosionSound() {
        initAudioContext();
        if (!audioCtx) return;
        try {
            const now = audioCtx.currentTime;

            const noiseLength = Math.max(1, Math.floor(audioCtx.sampleRate * 0.45));
            const noiseBuffer = audioCtx.createBuffer(1, noiseLength, audioCtx.sampleRate);
            const noiseData = noiseBuffer.getChannelData(0);
            for (let i = 0; i < noiseLength; i++) {
                const fade = 1 - (i / noiseLength);
                noiseData[i] = (Math.random() * 2 - 1) * fade;
            }

            const noise = audioCtx.createBufferSource();
            noise.buffer = noiseBuffer;
            const noiseFilter = audioCtx.createBiquadFilter();
            noiseFilter.type = 'lowpass';
            noiseFilter.frequency.setValueAtTime(900, now);
            noiseFilter.frequency.exponentialRampToValueAtTime(180, now + 0.4);
            const noiseGain = audioCtx.createGain();
            noiseGain.gain.setValueAtTime(0.34, now);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
            noise.connect(noiseFilter);
            noiseFilter.connect(noiseGain);
            noiseGain.connect(audioCtx.destination);

            const thump = audioCtx.createOscillator();
            const thumpGain = audioCtx.createGain();
            thump.type = 'sine';
            thump.frequency.setValueAtTime(105, now);
            thump.frequency.exponentialRampToValueAtTime(38, now + 0.28);
            thumpGain.gain.setValueAtTime(0.36, now);
            thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
            thump.connect(thumpGain);
            thumpGain.connect(audioCtx.destination);

            noise.start(now);
            noise.stop(now + 0.45);
            thump.start(now);
            thump.stop(now + 0.32);
        } catch(e) {}
    }

    let lastStepTime = 0;
    function playStepSound() {
        if (!audioCtx) return;
        const now = audioCtx.currentTime;
        if (now - lastStepTime < 0.26) return;
        lastStepTime = now;
        try {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(110, now);
            osc.frequency.exponentialRampToValueAtTime(40, now + 0.05);
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now);
            osc.stop(now + 0.05);
        } catch(e) {}
    }



    // WORK AT A PIZZA PLACE - original synthesized sound effects.
    // These tones are generated in-browser and do not use copyrighted recordings.
    let pizzaLastVehicleSoundAt = 0;
    function playPizzaSound(kind) {
        initAudioContext();
        if (!audioCtx) return;
        try {
            const now = audioCtx.currentTime;
            const tone = (freq, dur, vol=0.055, wave='square', delay=0, endFreq=null) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = wave;
                osc.frequency.setValueAtTime(freq, now + delay);
                if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, now + delay + dur);
                gain.gain.setValueAtTime(vol, now + delay);
                gain.gain.exponentialRampToValueAtTime(0.001, now + delay + dur);
                osc.connect(gain); gain.connect(audioCtx.destination);
                osc.start(now + delay); osc.stop(now + delay + dur);
            };
            if (kind === 'customer') { tone(660,.08,.045,'sine'); tone(880,.10,.04,'sine',.09); }
            else if (kind === 'order') { tone(523,.07,.05,'square'); tone(659,.07,.045,'square',.08); tone(784,.10,.04,'square',.16); }
            else if (kind === 'prep') { tone(220,.11,.045,'triangle',0,330); tone(300,.08,.04,'triangle',.14,420); }
            else if (kind === 'oven') { tone(115,.34,.035,'sine',0,90); tone(740,.08,.04,'square',.30); }
            else if (kind === 'boxing') { tone(150,.07,.06,'triangle'); tone(95,.09,.05,'triangle',.08); }
            else if (kind === 'delivery') { tone(523,.09,.055,'square'); tone(659,.09,.05,'square',.10); tone(784,.09,.05,'square',.20); tone(1047,.16,.045,'square',.30); }
            else if (kind === 'car') { tone(72,.13,.025,'sawtooth',0,58); }
            else if (kind === 'bike') { tone(330,.045,.025,'square'); tone(440,.045,.02,'square',.055); }
            else if (kind === 'vehicle_enter') { tone(250,.07,.04,'triangle'); tone(360,.09,.035,'triangle',.08); }
        } catch(e) {}
    }

    function playPizzaVehicleRollingSound(kind, movingAmount) {
        if (Math.abs(movingAmount) < 0.08) return;
        const now = performance.now();
        if (now - pizzaLastVehicleSoundAt < (kind === 'bike' ? 260 : 330)) return;
        pizzaLastVehicleSoundAt = now;
        playPizzaSound(kind === 'bike' ? 'bike' : 'car');
    }

    // WORK AT A PIZZA PLACE - original looping game music.
    // Synthesized in-browser from an original Dohblox melody; no commercial recording is used.
    let pizzaMusicPlaying = false;
    let pizzaMusicTimer = null;
    let pizzaMusicStep = 0;
    const PIZZA_MUSIC_MELODY = [
        72,76,79,76, 74,77,81,77,
        71,74,79,74, 69,72,76,72,
        67,71,74,71, 69,72,77,72,
        65,69,72,69, 67,71,74,null
    ];
    const PIZZA_MUSIC_BASS = [48,48,45,45,43,43,41,43];

    function playPizzaMusicStep() {
        if (!pizzaMusicPlaying || !isPizzaPlaceActive()) return;
        initAudioContext();
        if (!audioCtx) return;
        const step = pizzaMusicStep % PIZZA_MUSIC_MELODY.length;
        const melody = PIZZA_MUSIC_MELODY[step];
        const duck = boomboxPlaying ? 0.38 : 1.0;
        if (melody !== null) play8BitTone(melody, 0.14, 0.020 * duck, 'triangle');
        if (step % 4 === 0) {
            const bass = PIZZA_MUSIC_BASS[Math.floor(step / 4) % PIZZA_MUSIC_BASS.length];
            play8BitTone(bass, 0.28, 0.024 * duck, 'sine');
        }
        if (step % 4 === 2) play8BitTone(84, 0.025, 0.005 * duck, 'square');
        pizzaMusicStep++;
    }

    function startPizzaGameMusic() {
        if (pizzaMusicPlaying) return;
        pizzaMusicPlaying = true;
        pizzaMusicStep = 0;
        playPizzaMusicStep();
        pizzaMusicTimer = setInterval(playPizzaMusicStep, 190);
    }

    function stopPizzaGameMusic() {
        pizzaMusicPlaying = false;
        if (pizzaMusicTimer) clearInterval(pizzaMusicTimer);
        pizzaMusicTimer = null;
        pizzaMusicStep = 0;
    }




    // CROSSROADS - original retro background music made for Dohblox.
    let crossroadsMusicPlaying = false;
    let crossroadsMusicTimer = null;
    let crossroadsMusicStep = 0;
    const CROSSROADS_MUSIC_MELODY = [64,67,71,72,71,67,64,null, 62,66,69,71,69,66,62,null, 60,64,67,69,67,64,60,null, 59,62,66,67,66,62,59,null];
    const CROSSROADS_MUSIC_BASS = [40,40,38,38,36,36,35,35];
    function playCrossroadsMusicStep(){
        if(!crossroadsMusicPlaying || !isCrossroadsMapActive()) return; initAudioContext(); if(!audioCtx)return;
        const i=crossroadsMusicStep%CROSSROADS_MUSIC_MELODY.length,duck=boomboxPlaying?.38:1,n=CROSSROADS_MUSIC_MELODY[i];
        if(n!==null)play8BitTone(n,.16,.018*duck,'square');if(i%4===0)play8BitTone(CROSSROADS_MUSIC_BASS[Math.floor(i/4)%CROSSROADS_MUSIC_BASS.length],.30,.023*duck,'triangle');if(i%8===6)play8BitTone(88,.035,.004*duck,'square');crossroadsMusicStep++;
    }
    function startCrossroadsGameMusic(){if(crossroadsMusicPlaying)return;crossroadsMusicPlaying=true;crossroadsMusicStep=0;playCrossroadsMusicStep();crossroadsMusicTimer=setInterval(playCrossroadsMusicStep,205);}
    function stopCrossroadsGameMusic(){crossroadsMusicPlaying=false;if(crossroadsMusicTimer)clearInterval(crossroadsMusicTimer);crossroadsMusicTimer=null;crossroadsMusicStep=0;}


    // Original 8-bit eurodance-style loop made for Dohblox.
    // It deliberately does NOT reproduce the melody of any commercial song.
    const DOHBLOX_8BIT_MELODY = [
        69, 72, 76, null, 74, 77, 81, null,
        67, 71, 74, 78, 74, 71, 69, null,
        66, 69, 73, null, 71, 74, 78, null,
        64, 67, 71, 74, 71, 67, 66, null
    ];
    const DOHBLOX_8BIT_BASS = [45, 45, 48, 48, 43, 43, 47, 47];

    function midiToFrequency(note) {
        return 440 * Math.pow(2, (note - 69) / 12);
    }

    function play8BitTone(note, duration = 0.10, volume = 0.055, wave = 'square', detune = 0) {
        if (!audioCtx || note === null || note === undefined) return;
        try {
            const now = audioCtx.currentTime;
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = wave;
            osc.frequency.setValueAtTime(midiToFrequency(note), now);
            osc.detune.setValueAtTime(detune, now);
            gain.gain.setValueAtTime(volume, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now);
            osc.stop(now + duration);
        } catch(e) {}
    }

    function playBoomboxStep() {
        if (!boomboxPlaying) return;
        const step = boomboxStep % DOHBLOX_8BIT_MELODY.length;
        const melodyNote = DOHBLOX_8BIT_MELODY[step];
        if (melodyNote !== null) {
            play8BitTone(melodyNote, 0.095, 0.050, 'square');
            if (step % 4 === 2) play8BitTone(melodyNote + 12, 0.055, 0.018, 'square', -5);
        }

        if (step % 4 === 0) {
            const bassIndex = Math.floor(step / 4) % DOHBLOX_8BIT_BASS.length;
            play8BitTone(DOHBLOX_8BIT_BASS[bassIndex], 0.19, 0.060, 'triangle');
            play8BitTone(33, 0.055, 0.045, 'sine');
        }
        if (step % 2 === 1) play8BitTone(96, 0.025, 0.009, 'square');
        boomboxStep++;
    }

    function startBoomboxMusic() {
        initAudioContext();
        if (!audioCtx || boomboxPlaying) return;
        boomboxPlaying = true;
        boomboxStep = 0;
        playBoomboxStep();
        boomboxTimer = setInterval(playBoomboxStep, 125);
        addChatMessageUI('System', 'Boombox: playing the original Doh Dance 8-bit loop.');
    }

    function stopBoomboxMusic() {
        boomboxPlaying = false;
        if (boomboxTimer) {
            clearInterval(boomboxTimer);
            boomboxTimer = null;
        }
        boomboxStep = 0;
    }

    function toggleBoomboxMusic() {
        if (boomboxPlaying) stopBoomboxMusic();
        else startBoomboxMusic();
    }

    function triggerObbyBadgeWin() {
        if (!currentUser.badges) currentUser.badges = [];
        const badgeName = "you beat the obby!";
        
        let pRecord = playersDatabase.find(p => p.username.toLowerCase() === currentUser.username.toLowerCase());
        if(pRecord && (!pRecord.badges || !pRecord.badges.includes(badgeName))) {
            if(!pRecord.badges) pRecord.badges = [];
            pRecord.badges.push(badgeName);
            saveToStorage();
        }

        if (!currentUser.badges.includes(badgeName)) {
            currentUser.badges.push(badgeName);
            saveToStorage();
            playBadgeSound();
            
            const popup = document.getElementById('achievement-popup');
            document.getElementById('achievement-title-text').innerText = "you beat the obby!";
            popup.classList.add('show');

            addChatMessageUI("System", `${currentUser.username} earned the badge: you beat the obby!`);

            setTimeout(() => {
                popup.classList.remove('show');
            }, 4000);
        }
    }

    function selectHotbarSlot(index) {
        const wasBoombox = activeEquippedWeapon && activeEquippedWeapon.type === 'boombox';
        currentSelectedSlotIndex = index;
        const slots = document.querySelectorAll('.hotbar-slot');
        slots.forEach((s, idx) => {
            if(idx === index) s.classList.add('selected');
            else s.classList.remove('selected');
        });

        activeEquippedWeapon = inGameHotbar[index];
        if (wasBoombox && (!activeEquippedWeapon || activeEquippedWeapon.type !== 'boombox')) stopBoomboxMusic();
        updateHeldWeaponMesh();
    }

    function updateHotbarUI() {
        for(let i = 0; i < 6; i++) {
            const lbl = document.getElementById(`slot-lbl-${i}`);
            if(lbl) {
                lbl.innerText = inGameHotbar[i] ? inGameHotbar[i].name : 'Empty';
            }
        }
    }

    function updateHealthUI(hp) {
        playerHealth = Math.max(0, Math.min(100, hp));
        document.getElementById('health-bar-fill').style.width = playerHealth + '%';
        document.getElementById('health-bar-text').innerText = Math.round(playerHealth);
    }

    const accountOwnerUsername = "Owner";

    let currentUser = {
        username: "Guest",
        balance: 0,
        isOwner: false,
        isMod: false,
        isBanned: false,
        membership: "Member",
        badges: [],
        inventory: [],
        equipped: [],
        friends: [],
        followers: [],
        friendRequests: [],
        inbox: [
            { id: 1, sender: "System", text: "Welcome to Dohblox Mobile! Play games and explore places!" }
        ],
        colors: { torso: 0x0055b3, limbs: 0xffcc00 }
    };

    let gamesDatabase = [
        { id: 1, title: "Bloxy Obby Park", type: "obby", description: "Conquer tricky obstacle platforms in the high-flying Bloxy Obby to win the badge!" },
        { id: 2, title: "Work at a Pizza Place", type: "pizza", description: "Take orders, cook pizzas, and deliver orders to customers!" },
        { id: 3, title: "Crossroads [2009 Classic]", type: "crossroads", description: "Battle players on the classic 2009 Crossroads arena with full classic weapons loadout!" },
        { id: 4, title: "Classic 2009 Baseplate", type: "baseplate", description: "Experience the nostalgic green baseplate environment from classic 2009." },
        { id: 5, title: "Dohblox HQ", type: "doh_hq", description: "Explore the classic twin-tower Dohblox headquarters campus!" },
        { id: 6, title: "Natural Disaster Survival", type: "natural_disaster", description: "Survive 13 disasters across a 23-map rotation, earn Survivals, and power up the Weather Machine with Dohbux!" }
    ];

    let catalogDatabase = [
        { id: 1, name: "Classic Top Hat", price: 100, category: "hats", type: "top_hat" },
        { id: 2, name: "Gold Crown", price: 500, category: "hats", type: "crown" },
        { id: 3, name: "Boombox Gear", price: 350, category: "gear", type: "boombox" },
        { id: 4, name: "Cool Sunglasses", price: 75, category: "faces", type: "sunglasses" },
        { id: 5, name: "Epic Sword", price: 250, category: "gear", type: "sword" }
    ];

    // Shared player directory is loaded from Firestore.
    let playersDatabase = [];

    let activeReports = [];
    let viewingProfileUser = null;
    let currentPendingPurchase = null;
    let activeGameAnimId = null;

    let editorAvatarGroup = null;
    let profileAvatarGroup = null;
    let currentGameAvatar = null;

    let editorScene, editorCamera, editorRenderer;
    let profileScene, profileCamera, profileRenderer;


    // ============================================================
    // DOHBLOX CLOUD ACCOUNTS + CROSS-DEVICE SOCIAL SYNC
    // Passwords are handled only by Firebase Authentication.
    // Public/profile data is stored in Firestore; no password is stored here.
    // ============================================================
    let dohbloxCloudAuth = null;
    let dohbloxCloudDb = null;
    let dohbloxCloudReady = false;
    let dohbloxCloudInitPromise = null;
    let dohbloxCloudUsersUnsub = null;
    let dohbloxCloudCurrentProfileUnsub = null;
    let dohbloxCloudRequestsUnsub = null;
    let dohbloxCloudNotificationsUnsub = null;
    let dohbloxCloudFriendshipsUnsub = null;
    let dohbloxCloudProfileSaveTimer = null;
    let dohbloxCloudCurrentUid = null;

    function cleanPlayerRecordForCache(p) {
        const copy = Object.assign({}, p || {});
        delete copy.password;
        return copy;
    }

    function saveToStorage() {
        // Local storage is now only a cache/preferences layer, never a password database.
        localStorage.setItem('dohblox_user', JSON.stringify(cleanPlayerRecordForCache(currentUser)));
        localStorage.setItem('dohblox_players_cache', JSON.stringify(playersDatabase.map(cleanPlayerRecordForCache)));
        localStorage.removeItem('dohblox_players'); // remove legacy plaintext-password database
        scheduleCloudProfileSave();
    }

    function normalizeDohbloxUsername(name) {
        return String(name || '').trim().toLowerCase();
    }

    function maskAccountEmail(email) {
        const value = String(email || '').trim();
        const at = value.indexOf('@');
        if (at <= 1) return value;
        return value.slice(0, 1) + '***' + value.slice(at);
    }

    async function ensureCloudProfileForAuthUser(authUser, preferredUsername='') {
        if (!authUser || authUser.isAnonymous || !dohbloxCloudDb) return null;
        const ref = dohbloxCloudDb.collection('dohblox_users').doc(authUser.uid);
        const snap = await ref.get();
        if (snap.exists) return snap.data() || {};

        let username = String(preferredUsername || '').trim();
        if (!username || isGuestUser(username) || normalizeDohbloxUsername(username) === 'owner') username = 'Player';
        const profile = makeDefaultPlayerProfile(username);
        const payload = {
            username: profile.username,
            normalizedUsername: normalizeDohbloxUsername(profile.username),
            balance: 0,
            membership: 'Member',
            badges: [],
            bio: 'New player!',
            inventory: [],
            equipped: [],
            colors: profile.colors,
            isOwner: false,
            isMod: false,
            isBanned: false,
            createdAtMs: Date.now(),
            updatedAtMs: Date.now()
        };
        await ref.set(payload);
        return payload;
    }

    function makeDefaultPlayerProfile(username) {
        return {
            username: String(username || 'Player').trim(),
            normalizedUsername: normalizeDohbloxUsername(username),
            balance: 0,
            isOwner: false,
            isMod: false,
            isBanned: false,
            membership: 'Member',
            badges: [],
            bio: 'New player!',
            inventory: [],
            equipped: [],
            friends: [],
            followers: [],
            friendRequests: [],
            inbox: [],
            colors: { torso: 0x0055b3, limbs: 0xffcc00 }
        };
    }

    function applyCloudProfileToCurrentUser(data, uid) {
        if (!data) return;
        const base = makeDefaultPlayerProfile(data.username || currentUser.username);
        currentUser = Object.assign(base, currentUser || {}, data);
        currentUser.uid = uid || data.uid || currentUser.uid || null;
        currentUser.password = undefined;
        delete currentUser.password;
        if (!Array.isArray(currentUser.badges)) currentUser.badges = [];
        if (!Array.isArray(currentUser.inventory)) currentUser.inventory = [];
        if (!Array.isArray(currentUser.equipped)) currentUser.equipped = [];
        if (!Array.isArray(currentUser.friends)) currentUser.friends = [];
        if (!Array.isArray(currentUser.followers)) currentUser.followers = [];
        if (!Array.isArray(currentUser.friendRequests)) currentUser.friendRequests = [];
        if (!Array.isArray(currentUser.inbox)) currentUser.inbox = [];
        if (!currentUser.colors) currentUser.colors = { torso: 0x0055b3, limbs: 0xffcc00 };
        localStorage.setItem('dohblox_user', JSON.stringify(cleanPlayerRecordForCache(currentUser)));
        renderHeader();
        renderInbox();
        if (viewingProfileUser) loadProfileView(viewingProfileUser);
    }

    function cloudProfilePayload() {
        return {
            username: currentUser.username,
            normalizedUsername: normalizeDohbloxUsername(currentUser.username),
            balance: Number(currentUser.balance) || 0,
            membership: currentUser.membership || 'Member',
            badges: Array.isArray(currentUser.badges) ? currentUser.badges : [],
            bio: currentUser.bio || 'Welcome to Dohblox!',
            inventory: Array.isArray(currentUser.inventory) ? currentUser.inventory : [],
            equipped: Array.isArray(currentUser.equipped) ? currentUser.equipped : [],
            colors: currentUser.colors || { torso: 0x0055b3, limbs: 0xffcc00 },
            updatedAtMs: Date.now()
        };
    }

    function scheduleCloudProfileSave() {
        if (!dohbloxCloudReady || !dohbloxCloudAuth || !dohbloxCloudAuth.currentUser) return;
        const user = dohbloxCloudAuth.currentUser;
        if (user.isAnonymous || isGuestUser(currentUser.username)) return;
        clearTimeout(dohbloxCloudProfileSaveTimer);
        dohbloxCloudProfileSaveTimer = setTimeout(async () => {
            try {
                await dohbloxCloudDb.collection('dohblox_users').doc(user.uid).set(cloudProfilePayload(), { merge: true });
            } catch (err) {
                console.warn('Dohblox cloud profile save failed:', err);
            }
        }, 300);
    }

    async function ensureDohbloxCloud(showError = false) {
        if (dohbloxCloudReady && dohbloxCloudDb && dohbloxCloudAuth) return true;
        if (dohbloxCloudInitPromise) return dohbloxCloudInitPromise;
        if (!isFirebaseStudioConfigured()) {
            if (showError) alert('Firebase is not configured yet. Put your Firebase Project ID and Web API key into FIREBASE_STUDIO_DEFAULT (or use Firebase Setup on PC), then reload Dohblox.');
            return false;
        }
        dohbloxCloudInitPromise = (async () => {
            try {
                const ok = await initFirebasePublicStudio(false);
                if (!ok) throw new Error('Could not connect to Firebase.');
                dohbloxCloudAuth = firebaseStudioAuth;
                dohbloxCloudDb = firebaseStudioDb;
                firebaseStudioUser = firebaseStudioAuth.currentUser;
                dohbloxCloudReady = true;
                subscribeCloudUsers();
                return true;
            } catch (err) {
                console.error('Dohblox cloud startup failed:', err);
                if (showError) alert('Dohblox cloud connection failed: ' + err.message);
                return false;
            } finally {
                if (!dohbloxCloudReady) dohbloxCloudInitPromise = null;
            }
        })();
        return dohbloxCloudInitPromise;
    }

    async function initDohbloxCloud() {
        if (!await ensureDohbloxCloud(false)) return;
        dohbloxCloudAuth.onAuthStateChanged(async user => {
            if (!user) return;
            firebaseStudioUser = user;
            if (user.isAnonymous) {
                dohbloxCloudCurrentUid = null;
                unsubscribeCurrentSocial();
                return;
            }
            dohbloxCloudCurrentUid = user.uid;
            try {
                const snap = await dohbloxCloudDb.collection('dohblox_users').doc(user.uid).get();
                let data = snap.exists ? (snap.data() || {}) : null;
                if (!data) {
                    data = await ensureCloudProfileForAuthUser(user, currentUser && currentUser.username);
                    console.info('Created missing Dohblox Firestore profile for authenticated user:', user.uid);
                }
                if (data) {
                    if (data.isBanned) {
                        alert('This Dohblox account is banned.');
                        await dohbloxCloudAuth.signOut();
                        await dohbloxCloudAuth.signInAnonymously();
                        return;
                    }
                    applyCloudProfileToCurrentUser(data, user.uid);
                    subscribeCurrentSocial(user.uid);
                    if (currentUser.isOwner === true || currentUser.isMod === true) {
                        syncDohbloxRoomDirectory(true).catch(err => console.warn('Automatic room directory repair failed:', err));
                    }
                }
            } catch (err) {
                console.warn('Could not restore cloud account:', err);
            }
        });
    }

    function subscribeCloudUsers() {
        if (!dohbloxCloudDb || dohbloxCloudUsersUnsub) return;
        dohbloxCloudUsersUnsub = dohbloxCloudDb.collection('dohblox_users').limit(500).onSnapshot(snap => {
            playersDatabase = snap.docs.map(doc => {
                const d = doc.data() || {};
                return cleanPlayerRecordForCache(Object.assign(makeDefaultPlayerProfile(d.username || 'Player'), d, { uid: doc.id }));
            });
            localStorage.setItem('dohblox_players_cache', JSON.stringify(playersDatabase));
            if (viewingProfileUser) loadProfileView(viewingProfileUser);
        }, err => console.warn('User directory sync failed:', err));
    }

    function unsubscribeCurrentSocial() {
        [dohbloxCloudCurrentProfileUnsub, dohbloxCloudRequestsUnsub, dohbloxCloudNotificationsUnsub, dohbloxCloudFriendshipsUnsub].forEach(fn => { try { if (fn) fn(); } catch (_) {} });
        dohbloxCloudCurrentProfileUnsub = dohbloxCloudRequestsUnsub = dohbloxCloudNotificationsUnsub = dohbloxCloudFriendshipsUnsub = null;
    }

    function findCloudUserByName(name) {
        const key = normalizeDohbloxUsername(name);
        return playersDatabase.find(p => normalizeDohbloxUsername(p.username) === key) || null;
    }

    function makeFriendPairId(uidA, uidB) {
        return [String(uidA), String(uidB)].sort().join('__');
    }

    function subscribeCurrentSocial(uid) {
        if (!dohbloxCloudDb || !uid) return;
        unsubscribeCurrentSocial();

        dohbloxCloudCurrentProfileUnsub = dohbloxCloudDb.collection('dohblox_users').doc(uid).onSnapshot(doc => {
            if (doc.exists && dohbloxCloudAuth && dohbloxCloudAuth.currentUser && dohbloxCloudAuth.currentUser.uid === uid) {
                applyCloudProfileToCurrentUser(doc.data() || {}, uid);
            }
        }, err => console.warn('Current profile live sync failed:', err));

        dohbloxCloudRequestsUnsub = dohbloxCloudDb.collection('dohblox_friend_requests').doc(uid).collection('requests')
            .onSnapshot(snap => {
                currentUser.friendRequests = snap.docs.map(d => (d.data() || {}).senderName).filter(Boolean);
                renderInbox();
            }, err => console.warn('Friend request sync failed:', err));

        dohbloxCloudNotificationsUnsub = dohbloxCloudDb.collection('dohblox_notifications').doc(uid).collection('items')
            .orderBy('createdAtMs', 'desc').limit(100)
            .onSnapshot(snap => {
                currentUser.inbox = snap.docs.map(d => {
                    const x = d.data() || {};
                    return { id: d.id, sender: x.senderName || 'System', text: x.text || '' };
                });
                renderInbox();
            }, err => console.warn('Notification sync failed:', err));

        dohbloxCloudFriendshipsUnsub = dohbloxCloudDb.collection('dohblox_friendships').where('members', 'array-contains', uid)
            .onSnapshot(snap => {
                const names = [];
                snap.docs.forEach(doc => {
                    const d = doc.data() || {};
                    const members = Array.isArray(d.members) ? d.members : [];
                    const memberNames = Array.isArray(d.memberNames) ? d.memberNames : [];
                    const otherIndex = members.findIndex(x => x !== uid);
                    if (otherIndex >= 0 && memberNames[otherIndex]) names.push(memberNames[otherIndex]);
                });
                currentUser.friends = Array.from(new Set(names));
                renderInbox();
                renderHeader();
            }, err => console.warn('Friendship sync failed:', err));
    }

    function firebaseOpWithTimeout(promise, timeoutMs=12000, label='Firebase request') {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(Object.assign(new Error(label + ' timed out. Check your internet/Firebase setup and try again.'), { code: 'dohblox/timeout' })), timeoutMs);
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }

    function explainAuthError(err, creating=false) {
        const code = err && err.code ? String(err.code) : '';
        if (code === 'dohblox/timeout') return err.message;
        if (code === 'auth/wrong-password' || code === 'auth/invalid-credential' || code === 'auth/invalid-login-credentials' || code === 'auth/user-not-found') {
            return 'Username or password is incorrect.';
        }
        if (code === 'auth/email-already-in-use') return 'That email already has a DOHBLOX account. Use Sign In instead.';
        if (code === 'auth/invalid-email') return 'Enter a valid email address.';
        if (code === 'auth/user-disabled') return 'This Firebase account has been disabled.';
        if (code === 'auth/operation-not-allowed') return 'Firebase Email/Password sign-in is not enabled yet. Enable Email/Password in Firebase Authentication.';
        if (code === 'auth/network-request-failed') return 'Could not reach Firebase. Check your connection and try again.';
        if (code === 'auth/too-many-requests') return 'Too many login attempts. Try again later.';
        if (code === 'auth/weak-password') return 'Password must be at least 6 characters.';
        return (creating ? 'Could not create the cloud account: ' : 'Could not log in: ') + ((err && err.message) || err || 'Unknown Firebase error');
    }


    function validRecoveryEmail(v) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim()) && String(v || '').trim().length <= 254;
    }

    async function refreshAccountSecurityInfo() {
        const status = document.getElementById('recovery-email-status');
        if (!status) return;
        if (!dohbloxCloudAuth || !dohbloxCloudAuth.currentUser || dohbloxCloudAuth.currentUser.isAnonymous) {
            status.textContent = 'Account email: Log in to view.';
            return;
        }
        try {
            await dohbloxCloudAuth.currentUser.reload();
            const user = dohbloxCloudAuth.currentUser;
            status.textContent = `Account email: ${maskAccountEmail(user.email || '')} — ${user.emailVerified ? 'Verified' : 'Not verified'}`;
        } catch (err) {
            console.warn('Email status refresh failed:', err);
            status.textContent = 'Account email status could not be refreshed.';
        }
    }

    async function sendRecoveryVerification() {
        if (!await ensureDohbloxCloud(true) || !dohbloxCloudAuth.currentUser || dohbloxCloudAuth.currentUser.isAnonymous) return alert('Log in first.');
        const user = dohbloxCloudAuth.currentUser;
        const input = document.getElementById('setting-recovery-email');
        const requestedEmail = String(input && input.value || '').trim();
        const btn = document.getElementById('btn-send-email-code');
        if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
        try {
            if (requestedEmail && !validRecoveryEmail(requestedEmail)) return alert('Enter a valid email address.');
            if (requestedEmail && requestedEmail.toLowerCase() !== String(user.email || '').toLowerCase()) {
                if (typeof user.verifyBeforeUpdateEmail === 'function') {
                    await firebaseOpWithTimeout(user.verifyBeforeUpdateEmail(requestedEmail), 15000, 'Email change verification');
                    alert('Firebase sent a verification link to the new email. Open that link to finish changing your DOHBLOX sign-in email.');
                } else {
                    alert('This Firebase browser SDK cannot verify an email change. Sign in with your current email and use the Firebase Authentication account settings to update it.');
                }
            } else {
                await firebaseOpWithTimeout(user.sendEmailVerification(), 15000, 'Email verification');
                alert(`Firebase sent a verification link to ${maskAccountEmail(user.email)}.`);
            }
            if (input) input.value = '';
            await refreshAccountSecurityInfo();
        } catch (err) {
            console.warn('Email verification/change failed:', err);
            const code = String(err && err.code || '');
            if (code === 'auth/requires-recent-login') alert('For security, sign out and sign back in before changing your email.');
            else if (code === 'auth/email-already-in-use') alert('That email is already used by another Firebase account.');
            else alert((err && err.message) || 'Could not send the Firebase verification email.');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Save Email & Send Verification Link'; }
        }
    }

    async function sendForgotPasswordCode() {
        const email = String(document.getElementById('forgot-email-input')?.value || '').trim();
        if (!validRecoveryEmail(email)) return alert('Enter a valid account email address.');
        const btn = document.getElementById('btn-forgot-send');
        if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
        try {
            if (!await ensureDohbloxCloud(true)) throw new Error('Firebase is not configured.');
            await firebaseOpWithTimeout(dohbloxCloudAuth.sendPasswordResetEmail(email), 15000, 'Password reset email');
            alert('If that email has a DOHBLOX account, Firebase has sent a password-reset link.');
            showMainLoginPanel();
        } catch (err) {
            console.warn('Password reset email failed:', err);
            // Keep the response generic so the page does not reveal which emails have accounts.
            alert('If that email has a DOHBLOX account, Firebase will send a password-reset link.');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Send Password Reset Link'; }
        }
    }

    async function finishCloudAccountLogin(authUser, preferredUsername) {
        firebaseStudioUser = authUser;
        let data;
        try {
            data = await firebaseOpWithTimeout(ensureCloudProfileForAuthUser(authUser, preferredUsername), 12000, 'Loading Dohblox profile');
        } catch (profileErr) {
            console.error('Could not create/load Dohblox Firestore profile:', profileErr);
            alert('Firebase Authentication worked, but the Dohblox Firestore profile could not be loaded. Publish the secure Firestore rules and try again. Error: ' + (profileErr.message || profileErr));
            return false;
        }
        if (data && data.isBanned) {
            alert('This Dohblox account is banned.');
            await dohbloxCloudAuth.signOut();
            await dohbloxCloudAuth.signInAnonymously();
            return false;
        }
        dohbloxCloudCurrentUid = authUser.uid;
        applyCloudProfileToCurrentUser(data || makeDefaultPlayerProfile(preferredUsername), authUser.uid);
        subscribeCurrentSocial(authUser.uid);

        // Free/Spark build: authenticated staff seed the six protected built-in room documents.
        // Firestore rules reject these writes from normal players, even if they edit their local JavaScript.
        if (currentUser.isOwner === true || currentUser.isMod === true) {
            await syncDohbloxRoomDirectory(true).catch(err => console.warn('Built-in room directory repair failed:', err));
        }
        refreshAccountSecurityInfo().catch(() => {});
        return true;
    }

    async function cloudLogin(email, password) {
        if (!await ensureDohbloxCloud(true)) return false;
        if (!validRecoveryEmail(email)) {
            alert('Enter the email address for your DOHBLOX account.');
            return false;
        }
        if (password.length < 6) {
            alert('Passwords must be at least 6 characters.');
            return false;
        }
        try {
            const cred = await firebaseOpWithTimeout(
                dohbloxCloudAuth.signInWithEmailAndPassword(email, password),
                12000,
                'DOHBLOX login'
            );
            return await finishCloudAccountLogin(cred.user, '');
        } catch (err) {
            console.warn('Cloud sign in failed:', err);
            alert(explainAuthError(err, false));
            return false;
        }
    }

    async function cloudCreateAccount(username, email, password) {
        if (!await ensureDohbloxCloud(true)) return false;
        if (!username || isGuestUser(username)) {
            alert('Choose a valid DOHBLOX username.');
            return false;
        }
        const normalized = normalizeDohbloxUsername(username);
        if (normalized === 'owner') {
            alert('Owner is a reserved protected account name.');
            return false;
        }
        if (!validRecoveryEmail(email)) {
            alert('Enter a valid email address.');
            return false;
        }
        if (password.length < 6) {
            alert('Passwords must be at least 6 characters.');
            return false;
        }
        try {
            const existing = await firebaseOpWithTimeout(
                dohbloxCloudDb.collection('dohblox_users').where('normalizedUsername', '==', normalized).limit(1).get(),
                12000,
                'Checking username'
            );
            if (!existing.empty) {
                alert('That DOHBLOX username is already taken.');
                return false;
            }

            if (dohbloxCloudAuth.currentUser && dohbloxCloudAuth.currentUser.isAnonymous) {
                try { await dohbloxCloudAuth.signOut(); } catch (_) {}
            }
            const cred = await firebaseOpWithTimeout(
                dohbloxCloudAuth.createUserWithEmailAndPassword(email, password),
                12000,
                'DOHBLOX account creation'
            );
            const ok = await finishCloudAccountLogin(cred.user, username);
            if (!ok) return false;
            try {
                await cred.user.sendEmailVerification();
                alert('Account created! Firebase sent a verification link to your email.');
            } catch (verifyErr) {
                console.warn('Initial verification email failed:', verifyErr);
                alert('Account created. You can resend the verification link from Settings > Security.');
            }
            return true;
        } catch (err) {
            console.error('Cloud account creation failed:', err);
            alert(explainAuthError(err, true));
            // Restore anonymous Firebase access if account creation did not sign us in.
            try { if (!dohbloxCloudAuth.currentUser) await dohbloxCloudAuth.signInAnonymously(); } catch (_) {}
            return false;
        }
    }

    async function cloudLogout() {
        unsubscribeCurrentSocial();
        dohbloxCloudCurrentUid = null;
        try {
            if (await ensureDohbloxCloud(false)) {
                await dohbloxCloudAuth.signOut();
                const anonCred = await dohbloxCloudAuth.signInAnonymously();
                firebaseStudioUser = anonCred.user;
            }
        } catch (err) {
            console.warn('Cloud logout failed:', err);
        }
    }

        window.onload = function() {
        const savedUser = localStorage.getItem('dohblox_user');
        if (savedUser) {
            try { currentUser = JSON.parse(savedUser); } catch(e) {}
        }
        localStorage.removeItem('dohblox_players');
        const savedPlayers = localStorage.getItem('dohblox_players_cache');
        if (savedPlayers) {
            try { playersDatabase = JSON.parse(savedPlayers); } catch(e) {}
        }
        if(!currentUser.friends) currentUser.friends = [];
        if(!currentUser.followers) currentUser.followers = [];
        if(!currentUser.friendRequests) currentUser.friendRequests = [];
        if(!currentUser.inbox) currentUser.inbox = [];
        ensurePizzaProgress();
        initDohbloxStudioSync();
        loadPublishedStudioGames(false);
        refreshPublicStudioGames(true);
        if(!publicStudioRefreshTimer) publicStudioRefreshTimer=setInterval(()=>refreshPublicStudioGames(true),20000);
        window.addEventListener('focus',()=>refreshPublicStudioGames(true));

        initMultiplayerNetwork();
        initDohbloxCloud();
        renderHeader();
        renderGamesGrid();
        renderCatalog('all');
        renderReportsList();
        renderInbox();
        setupKeyboardAndMouseListeners();
    };


    /* REAL-TIME MULTIPLAYER SYSTEM — FIRESTORE ACROSS BROWSERS/DEVICES */
    function initMultiplayerNetwork() {
        // BroadcastChannel remains only as an offline/local fallback.
        if ('BroadcastChannel' in window) {
            multiChannel = new BroadcastChannel('dohblox_game_multiplayer');
            multiChannel.onmessage = handleNetworkMessage;
        }
    }

    function hashRoomName(text) {
        let h = 2166136261;
        const s = String(text || 'dohblox');
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return (h >>> 0).toString(36);
    }

    function getActiveRoomKey(gameTitle) {
        const gameIdentity = activeGameRecord && (activeGameRecord.studioId || activeGameRecord.id || activeGameRecord.title);
        return `${gameIdentity || gameTitle || 'game'}|${gameTitle || ''}`;
    }


    let dohbloxRoomDirectorySignature = '';

    function getGameRecordRoomKey(record) {
        const r = record || {};
        const identity = r.studioId || r.id || r.title || 'game';
        return `${identity}|${r.title || ''}`;
    }

    function getGameRecordRoomId(record) {
        return 'room_' + hashRoomName(getGameRecordRoomKey(record));
    }

    function roomDirectoryPayload(record, listed=true) {
        const r = record || {};
        return {
            gameId: String(r.id ?? r.studioId ?? ''),
            studioId: r.studioId ? String(r.studioId) : '',
            gameTitle: String(r.title || 'Untitled Game'),
            gameType: String(r.type || 'baseplate'),
            description: String(r.description || '').slice(0, 220),
            owner: String(r.owner || (r.type === 'studio_published' ? 'Builder' : 'Dohblox')).slice(0, 40),
            ownerUid: String(r.ownerUid || ''),
            publicStudioGame: r.type === 'studio_published' && !!r.public,
            builtIn: r.type !== 'studio_published',
            listed: !!listed,
            archived: !listed,
            directory: true,
            updatedAtMs: Date.now()
        };
    }

    async function registerDohbloxRoom(record, listed=true) {
        if (!record || record.temporary) return false;
        if (!await ensureDohbloxCloud(false)) return false;
        const ref = dohbloxCloudDb.collection('dohblox_rooms').doc(getGameRecordRoomId(record));
        await ref.set(roomDirectoryPayload(record, listed), { merge: true });
        return true;
    }

    async function syncDohbloxRoomDirectory(force=false) {
        if (!await ensureDohbloxCloud(false)) return false;
        const uid = dohbloxCloudAuth && dohbloxCloudAuth.currentUser ? dohbloxCloudAuth.currentUser.uid : '';
        const staff = currentUser.isOwner === true || currentUser.isMod === true;
        // Spark/free build: Firestore rules allow built-in room writes only for protected staff accounts.
        // Normal players can only sync their own public Studio game rooms.
        const records = gamesDatabase.filter(g => g && !g.temporary && (
            (g.type !== 'studio_published' && staff) ||
            (g.type === 'studio_published' && g.public && g.ownerUid === uid)
        ));
        const signature = records.map(g => [g.studioId || g.id || g.title, g.title, g.type, !!g.public].join(':')).sort().join('|');
        if (!force && signature === dohbloxRoomDirectorySignature) return true;
        try {
            const batch = dohbloxCloudDb.batch();
            records.forEach(g => {
                const ref = dohbloxCloudDb.collection('dohblox_rooms').doc(getGameRecordRoomId(g));
                batch.set(ref, roomDirectoryPayload(g, true), { merge: true });
            });
            await batch.commit();
            // Only remember a successful sync. Failed writes must be retried later.
            dohbloxRoomDirectorySignature = signature;
            console.info(`Dohblox room directory synced: ${records.length} game room(s).`);
            return true;
        } catch (err) {
            console.warn('Dohblox room directory sync failed:', err);
            return false;
        }
    }

    async function joinCloudGameRoom(gameTitle) {
        await leaveCloudGameRoom(false);
        if (!await ensureDohbloxCloud(false)) {
            cloudRoomActive = false;
            return false;
        }
        try {
            cloudRoomId = getGameRecordRoomId(activeGameRecord || { id: gameTitle, title: gameTitle, type: 'game' });
            cloudRoomRef = dohbloxCloudDb.collection('dohblox_rooms').doc(cloudRoomId);
            cloudRoomJoinedAt = Date.now();
            cloudSeenEventIds.clear();
            const roomRecord = activeGameRecord || {id:gameTitle,title:gameTitle,type:'game'};
            const signedUid = dohbloxCloudAuth && dohbloxCloudAuth.currentUser ? dohbloxCloudAuth.currentUser.uid : '';
            const mayWriteDirectory = currentUser.isOwner === true || currentUser.isMod === true ||
                (roomRecord.type === 'studio_published' && roomRecord.ownerUid && roomRecord.ownerUid === signedUid);
            if (mayWriteDirectory) {
                await cloudRoomRef.set(Object.assign(roomDirectoryPayload(roomRecord, true), { gameTitle: gameTitle, lastJoinedAtMs: Date.now() }), { merge: true });
            }

            cloudRoomPlayersUnsub = cloudRoomRef.collection('players').onSnapshot(snap => {
                snap.docChanges().forEach(change => {
                    const d = change.doc.data() || {};
                    const sid = d.senderId || change.doc.id;
                    if (!sid || sid === localSessionId) return;
                    if (change.type === 'removed') {
                        removeRemotePlayer(sid);
                        return;
                    }
                    const synthetic = {
                        senderId: sid,
                        senderUid: d.uid || '',
                        username: d.username || 'Player',
                        gameTitle: activeGameTitle,
                        type: 'STATE_UPDATE',
                        payload: d.payload || {},
                        timestamp: d.updatedAtMs || Date.now()
                    };
                    handleNetworkMessage({ data: synthetic });
                });
            }, err => console.warn('Multiplayer player sync failed:', err));

            cloudRoomEventsUnsub = cloudRoomRef.collection('events').orderBy('createdAtMs', 'desc').limit(100).onSnapshot(snap => {
                snap.docChanges().forEach(change => {
                    if (change.type !== 'added') return;
                    if (cloudSeenEventIds.has(change.doc.id)) return;
                    cloudSeenEventIds.add(change.doc.id);
                    const d = change.doc.data() || {};
                    if ((d.createdAtMs || 0) < cloudRoomJoinedAt - 1500) return;
                    if (d.senderId === localSessionId) return;
                    handleNetworkMessage({ data: d });
                });
            }, err => console.warn('Multiplayer event sync failed:', err));

            cloudRoomActive = true;
            return true;
        } catch (err) {
            console.error('Could not join multiplayer room:', err);
            cloudRoomActive = false;
            return false;
        }
    }

    async function leaveCloudGameRoom(deletePresence = true) {
        try { if (cloudRoomPlayersUnsub) cloudRoomPlayersUnsub(); } catch (_) {}
        try { if (cloudRoomEventsUnsub) cloudRoomEventsUnsub(); } catch (_) {}
        cloudRoomPlayersUnsub = null;
        cloudRoomEventsUnsub = null;
        if (deletePresence && cloudRoomRef) {
            try { await cloudRoomRef.collection('players').doc(localSessionId).delete(); } catch (_) {}
        }
        cloudRoomRef = null;
        cloudRoomId = null;
        cloudRoomActive = false;
        cloudSeenEventIds.clear();
    }

    function makeNetworkEnvelope(type, payload = {}) {
        return {
            messageId: `${localSessionId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            senderId: localSessionId,
            senderUid: dohbloxCloudAuth && dohbloxCloudAuth.currentUser ? dohbloxCloudAuth.currentUser.uid : '',
            username: currentUser.username,
            gameTitle: activeGameTitle,
            type: type,
            payload: payload,
            createdAtMs: Date.now(),
            timestamp: Date.now()
        };
    }

    function sendNetworkMessage(type, payload = {}) {
        if (!activeGameTitle) return;
        const msg = makeNetworkEnvelope(type, payload);

        if (cloudRoomActive && cloudRoomRef) {
            if (type === 'JOIN_GAME' || type === 'HEARTBEAT' || type === 'STATE_UPDATE') {
                cloudRoomRef.collection('players').doc(localSessionId).set({
                    senderId: localSessionId,
                    uid: msg.senderUid,
                    username: currentUser.username,
                    gameTitle: activeGameTitle,
                    payload: payload,
                    updatedAtMs: Date.now()
                }, { merge: true }).catch(err => console.warn('Player state send failed:', err));
            } else if (type === 'LEAVE_GAME') {
                cloudRoomRef.collection('players').doc(localSessionId).delete().catch(() => {});
            } else {
                cloudRoomRef.collection('events').add(msg).catch(err => console.warn('Multiplayer event send failed:', err));
            }
            return;
        }

        // Offline/same-device fallback.
        if (multiChannel) multiChannel.postMessage(msg);
    }

        function handleNetworkMessage(e) {
        const msg = e.data;
        if (!msg || msg.senderId === localSessionId) return;
        if (!activeGameTitle || msg.gameTitle !== activeGameTitle) {
            if (remotePlayers[msg.senderId]) {
                removeRemotePlayer(msg.senderId);
            }
            return;
        }

        const id = msg.senderId;
        if (msg.type === 'JOIN_GAME' || msg.type === 'HEARTBEAT' || msg.type === 'STATE_UPDATE') {
            let p = remotePlayers[id];
            if (!p) {
                p = createRemotePlayer(id, msg.username, msg.payload);
                remotePlayers[id] = p;
                updateGameLeaderboard();
                updateESCMenuPlayerList();
            }
            p.lastSeen = Date.now();
            if (msg.username && p.username !== msg.username) {
                p.username = msg.username;
                if (p.nameTagEl) p.nameTagEl.innerText = msg.username;
            }
            if (msg.payload.position && p.mesh) {
                p.mesh.position.set(msg.payload.position.x, msg.payload.position.y, msg.payload.position.z);
            }
            if (msg.payload.yaw !== undefined && p.mesh) {
                p.mesh.rotation.y = msg.payload.yaw;
            }
            if (isNaturalDisasterActive()) { p.ndsInfected = !!msg.payload.ndsInfected; }
            if (isPizzaPlaceActive()) {
                updateRemotePizzaOrder(id, msg.username, msg.payload.pizzaOrder);
                if (p.mesh && msg.payload.pizzaVehicle === 'bike') {
                    p.mesh.visible = true;
                    p.mesh.rotation.y = Number.isFinite(msg.payload.pizzaVehicleYaw) ? msg.payload.pizzaVehicleYaw : p.mesh.rotation.y;
                    setPizzaBikeRiderPose(p.mesh, true);
                } else if (p.mesh) {
                    p.mesh.visible = true;
                    setPizzaBikeRiderPose(p.mesh, false);
                }
            }
        } else if (msg.type === 'PIZZA_ORDER_STATUS') {
            if (isPizzaPlaceActive()) updateRemotePizzaOrder(id, msg.username, msg.payload);
        } else if (msg.type === 'CHAT') {
            addChatMessageUI(msg.username, msg.payload.text);
            showOverheadChatBubble(id, msg.username, msg.payload.text);
        } else if (msg.type === 'ANNOUNCEMENT') {
            if (msg.payload && msg.payload.authorized && msg.payload.text) addAnnouncementUI(msg.username, msg.payload.text);
        } else if (msg.type === 'DANCE') {
            const p = remotePlayers[id];
            if (p) p.danceUntil = Date.now() + Math.min(15000, Math.max(1000, Number(msg.payload && msg.payload.durationMs) || 8000));
        } else if (msg.type === 'HQ_RESET') {
            if (isDohbloxHQActive()) resetDohbloxHQWorld(false);
        } else if (msg.type === 'CROSSROADS_PROJECTILE') {
            if (isCrossroadsActive()) {
                const projectileData = Object.assign({}, msg.payload, { ownerId: id });
                spawnCrossroadsProjectile(projectileData, false);
            }
        } else if (msg.type === 'CROSSROADS_TIMEBOMB') {
            if (isCrossroadsActive()) {
                const bombData = Object.assign({}, msg.payload, { ownerId: id });
                createCrossroadsBomb(bombData, false);
            }
        } else if (msg.type === 'CROSSROADS_WALL') {
            if (isCrossroadsActive()) {
                const wallData = Object.assign({}, msg.payload, { ownerId: id });
                createCrossroadsWall(wallData, false);
            }
        } else if (msg.type === 'CROSSROADS_SWORD_SWING') {
            if (isCrossroadsActive()) {
                handleCrossroadsSwordSwing(msg.payload);
            }
        } else if (msg.type === 'NDS_STATE_REQUEST') {
            if (isNaturalDisasterActive() && ndsStateStarted) broadcastNDSState();
        } else if (msg.type === 'NDS_ROUND_STATE') {
            if (isNaturalDisasterActive()) applyNDSState(msg.payload);
        } else if (msg.type === 'NDS_WEATHER_BOOST') {
            if (isNaturalDisasterActive()) { ndsWeatherPower=Math.max(ndsWeatherPower,Math.min(NDS_MAX_WEATHER_POWER,Number(msg.payload&&msg.payload.weatherPower)||0)); updateNDSHud(); }
        } else if (msg.type === 'NDS_INFECT') {
            const p=remotePlayers[id]; if(p) p.ndsInfected=!!(msg.payload&&msg.payload.infected);
        } else if (msg.type === 'SPAWN_SHIELD') {
            const p = remotePlayers[id];
            if (p && p.mesh) {
                const durationMs = Math.min(8000, Math.max(500, Number(msg.payload && msg.payload.durationMs) || 4500));
                addSpawnShieldToAvatar(p.mesh, durationMs);
            }
        } else if (msg.type === 'LEAVE_GAME') {
            removeRemotePlayer(id);
        }
    }

    function createRemotePlayer(id, username, data) {
        const colors = data.colors || { torso: 0x0055b3, limbs: 0xffcc00 };
        const charMesh = createR6Character(colors.torso, colors.limbs);
        
        if (data.equipped && Array.isArray(data.equipped)) {
            data.equipped.forEach(item => {
                const acc = create3DAccessoryMesh(item.type);
                acc.name = `acc_${item.id}`;
                if(item.type === 'top_hat' || item.type === 'crown') acc.position.set(0, 3.15, 0);
                else if(item.type === 'sunglasses') acc.position.set(0, 2.75, 0.38);
                else if(item.type === 'boombox') acc.position.set(0, 1.9, -0.35);
                else if(item.type === 'sword') { acc.position.set(0.62, 1.9, 0.2); acc.rotation.z = -Math.PI / 4; }
                charMesh.add(acc);
            });
        }

        if (data.position) {
            charMesh.position.set(data.position.x, data.position.y, data.position.z);
        }
        if (gameScene) {
            gameScene.add(charMesh);
        }
        const nameTagEl = createPlayerNameTag(username);
        addSpawnShieldToAvatar(charMesh, 4500);

        return {
            id: id,
            username: username,
            mesh: charMesh,
            lastSeen: Date.now(),
            chatBubbleEl: null,
            nameTagEl: nameTagEl
        };
    }

    function removeRemotePlayer(id) {
        const p = remotePlayers[id];
        if (p) {
            if (p.mesh && gameScene) gameScene.remove(p.mesh);
            if (p.chatBubbleEl && p.chatBubbleEl.parentNode) p.chatBubbleEl.parentNode.removeChild(p.chatBubbleEl);
            if (p.nameTagEl && p.nameTagEl.parentNode) p.nameTagEl.parentNode.removeChild(p.nameTagEl);
            delete remotePlayers[id];
            delete pizzaRemoteOrders[id];
            updatePizzaHud();
            updateGameLeaderboard();
            updateESCMenuPlayerList();
        }
    }

    function checkRemotePlayerTimeouts() {
        const now = Date.now();
        for (let id in remotePlayers) {
            if (now - remotePlayers[id].lastSeen > 4000) {
                removeRemotePlayer(id);
            }
        }
    }

    function updateGameLeaderboard() {
        const container = document.getElementById('leaderboard-list');
        if (!container) return;

        let activePlayersList = [
            { username: currentUser.username, isSelf: true }
        ];

        for (let id in remotePlayers) {
            activePlayersList.push({ username: remotePlayers[id].username, isSelf: false });
        }

        container.innerHTML = activePlayersList.map(p => `
            <div style="padding: 3px 0; border-bottom: 1px solid rgba(255,255,255,0.15); font-weight: ${p.isSelf ? 'bold' : 'normal'}; color: ${p.isSelf ? '#ffcc00' : '#ffffff'};">
                ${p.username} ${p.isSelf ? '(You)' : ''}
            </div>
        `).join('');
    }

    function updateESCMenuPlayerList() {
        const tbody = document.getElementById('r2009-players-list-body');
        if (!tbody) return;

        let activePlayersList = [
            { username: currentUser.username, isSelf: true }
        ];

        for (let id in remotePlayers) {
            activePlayersList.push({ username: remotePlayers[id].username, isSelf: false });
        }

        tbody.innerHTML = activePlayersList.map(p => `
            <tr>
                <td style="font-weight:${p.isSelf ? 'bold' : 'normal'}; color:${p.isSelf ? '#ffcc00' : '#ffffff'};">
                    ${p.username} ${p.isSelf ? '(You)' : ''}
                </td>
                <td><span style="color:#00ff00; font-weight:bold;">In Server</span></td>
                <td>
                    ${p.isSelf ? '<em>Self</em>' : `<button class="r2009-btn" onclick="inspectReportedUser('${p.username}')">Inspect</button>`}
                </td>
            </tr>
        `).join('');
    }

    function showOverheadChatBubble(senderId, username, text) {
        const container = document.getElementById('world-chat-bubbles-container');
        if (!container) return;

        let bubbleEl = null;
        if (senderId === localSessionId) {
            if (!localChatBubble) {
                localChatBubble = document.createElement('div');
                localChatBubble.className = 'overhead-bubble';
                container.appendChild(localChatBubble);
            }
            bubbleEl = localChatBubble;
        } else if (remotePlayers[senderId]) {
            if (!remotePlayers[senderId].chatBubbleEl) {
                remotePlayers[senderId].chatBubbleEl = document.createElement('div');
                remotePlayers[senderId].chatBubbleEl.className = 'overhead-bubble';
                container.appendChild(remotePlayers[senderId].chatBubbleEl);
            }
            bubbleEl = remotePlayers[senderId].chatBubbleEl;
        }

        if (bubbleEl) {
            bubbleEl.innerText = `${username}: ${text}`;
            bubbleEl.style.opacity = '1';

            if (bubbleEl.timeoutId) clearTimeout(bubbleEl.timeoutId);
            bubbleEl.timeoutId = setTimeout(() => {
                if (bubbleEl) bubbleEl.style.opacity = '0';
            }, 5000);
        }
    }

    function updateOverheadBubblesPosition() {
        if (!gameCamera) return;

        if (localChatBubble && localChatBubble.style.opacity !== '0') {
            projectToScreen(localChatBubble, playerPos.x, playerPos.y + 3.4, playerPos.z);
        }

        for (let id in remotePlayers) {
            const p = remotePlayers[id];
            if (p.nameTagEl && p.mesh) {
                projectToScreen(p.nameTagEl, p.mesh.position.x, p.mesh.position.y + 3.25, p.mesh.position.z);
            }
            if (p.chatBubbleEl && p.mesh && p.chatBubbleEl.style.opacity !== '0') {
                projectToScreen(p.chatBubbleEl, p.mesh.position.x, p.mesh.position.y + 3.85, p.mesh.position.z);
            }
        }
    }

    function projectToScreen(el, x, y, z) {
        const tempV = new THREE.Vector3(x, y, z);
        tempV.project(gameCamera);

        if (tempV.z > 1) {
            el.style.display = 'none';
            return;
        }

        const hw = window.innerWidth / 2;
        const hh = window.innerHeight / 2;
        const screenX = (tempV.x * hw) + hw;
        const screenY = -(tempV.y * hh) + hh;

        el.style.display = 'block';
        el.style.left = `${screenX}px`;
        el.style.top = `${screenY}px`;
    }

    window.addEventListener('beforeunload', () => {
        if (activeGameTitle) {
            sendNetworkMessage('LEAVE_GAME', {});
            if (cloudRoomRef) cloudRoomRef.collection('players').doc(localSessionId).delete().catch(() => {});
        }
    });

    function switchTab(tabName) {
        if (tabName === 'settings' && isGuestUser(currentUser.username)) {
            alert("Account Settings are not available for Guest accounts.");
            return;
        }

        if (tabName === 'moderation' && (!(currentUser.isMod || currentUser.isOwner) || isGuestUser(currentUser.username))) {
            alert("Mod Hub is not available for Guest accounts.");
            return;
        }

        ['games', 'inbox', 'catalog', 'avatar', 'shop', 'profile', 'moderation', 'settings'].forEach(s => {
            const el = document.getElementById(`section-${s}`);
            if(el) el.classList.add('hidden');
        });
        const target = document.getElementById(`section-${tabName}`);
        if(target) target.classList.remove('hidden');

        if(tabName === 'avatar') {
            setTimeout(() => initAvatarEditor3D(), 10);
        }

        if(tabName === 'profile' && !viewingProfileUser) {
            loadProfileView(currentUser.username);
        }
        if(tabName === 'inbox') {
            renderInbox();
        }
    }

    function isGuestUser(username) {
        return /^Guest(\s*\d+)?$/i.test(username.trim());
    }

    function openMyOwnProfile() {
        viewingProfileUser = null;
        switchTab('profile');
        loadProfileView(currentUser.username);
    }

    function renderInbox() {
        const container = document.getElementById('inbox-messages-container');
        if(!container) return;

        let html = '';
        if(currentUser.friendRequests && currentUser.friendRequests.length > 0) {
            html += `<h4 style="color:#0055b3; margin-bottom:5px;">Pending Friend Requests</h4>`;
            currentUser.friendRequests.forEach((reqUser, idx) => {
                html += `
                    <div style="border: 1px solid #b5b5b5; background: #f9f9f9; padding: 8px; margin-bottom: 6px; display:flex; justify-content:space-between; align-items:center;">
                        <span><strong>${reqUser}</strong> sent you a friend request.</span>
                        <div>
                            <button class="btn-mod" style="padding:2px 8px;" onclick="acceptFriendRequest('${reqUser}')">Accept</button>
                            <button class="btn-danger" style="padding:2px 8px;" onclick="declineFriendRequest(${idx})">Decline</button>
                        </div>
                    </div>
                `;
            });
        }

        html += `<h4 style="color:#333; margin-top:15px; margin-bottom:5px;">Messages & Notifications</h4>`;
        if(!currentUser.inbox || currentUser.inbox.length === 0) {
            html += `<p style="color:#666;">No new messages or notifications.</p>`;
        } else {
            currentUser.inbox.slice().reverse().forEach(msg => {
                html += `
                    <div style="border-bottom: 1px solid #eee; padding: 8px 0;">
                        <strong>${msg.sender}:</strong> <span style="color: gray;">- Notification</span><br>
                        <small>${msg.text}</small>
                    </div>
                `;
            });
        }
        container.innerHTML = html;
    }


    async function acceptFriendRequest(fromUser) {
        const target = findCloudUserByName(fromUser);
        if (target && target.uid && dohbloxCloudCurrentUid && await ensureDohbloxCloud(false)) {
            const pairId = makeFriendPairId(dohbloxCloudCurrentUid, target.uid);
            const members = [dohbloxCloudCurrentUid, target.uid].sort();
            const nameByUid = {};
            nameByUid[dohbloxCloudCurrentUid] = currentUser.username;
            nameByUid[target.uid] = target.username;
            const memberNames = members.map(uid => nameByUid[uid] || 'Player');
            await dohbloxCloudDb.collection('dohblox_friendships').doc(pairId).set({ members, memberNames, createdAtMs: Date.now() });
            await dohbloxCloudDb.collection('dohblox_friend_requests').doc(dohbloxCloudCurrentUid).collection('requests').doc(target.uid).delete().catch(() => {});
            alert(`You are now friends with ${fromUser}!`);
            return;
        }
        if (!currentUser.friends.includes(fromUser)) currentUser.friends.push(fromUser);
        currentUser.friendRequests = currentUser.friendRequests.filter(u => u !== fromUser);
        saveToStorage(); renderInbox();
    }

    
    async function declineFriendRequest(idx) {
        const fromUser = currentUser.friendRequests[idx];
        const target = findCloudUserByName(fromUser);
        if (target && target.uid && dohbloxCloudCurrentUid && await ensureDohbloxCloud(false)) {
            await dohbloxCloudDb.collection('dohblox_friend_requests').doc(dohbloxCloudCurrentUid).collection('requests').doc(target.uid).delete().catch(() => {});
            return;
        }
        currentUser.friendRequests.splice(idx, 1); saveToStorage(); renderInbox();
    }

        function openInviteModal() {
        if(isGuestUser(currentUser.username)) {
            alert("Guests cannot invite friends. Please login or create an account.");
            return;
        }
        document.getElementById('invite-friend-input').value = '';
        document.getElementById('invite-modal').classList.remove('hidden');
    }

    function closeInviteModal() {
        document.getElementById('invite-modal').classList.add('hidden');
    }


    async function sendFriendInvite() {
        const friendName = document.getElementById('invite-friend-input').value.trim();
        if (!friendName) return alert('Please enter a username.');
        if (friendName.toLowerCase() === currentUser.username.toLowerCase()) return alert('You cannot invite yourself!');
        const target = findCloudUserByName(friendName);
        if (target && target.uid && dohbloxCloudCurrentUid && await ensureDohbloxCloud(false)) {
            await dohbloxCloudDb.collection('dohblox_notifications').doc(target.uid).collection('items').add({
                senderUid: dohbloxCloudCurrentUid, senderName: currentUser.username,
                text: `${currentUser.username} invited you to play Dohblox!`, createdAtMs: Date.now()
            });
            closeInviteModal(); alert(`Invitation sent to ${friendName}!`); return;
        }
        alert('That cloud player was not found.');
    }

        function switchSettingsSubTab(sub) {
        ['info', 'privacy', 'billing', 'security'].forEach(s => {
            const el = document.getElementById(`sub-setting-${s}`);
            if(el) el.classList.add('hidden');
        });
        document.getElementById(`sub-setting-${sub}`).classList.remove('hidden');
        if (sub === 'security') refreshAccountSecurityInfo().catch(() => {});
    }


    async function saveAccountSettings() {
        const newUsername = document.getElementById('setting-username-input').value.trim();
        const newBio = document.getElementById('setting-bio-input').value.trim();
        if (!newUsername) return alert('Username cannot be empty.');
        if (isGuestUser(newUsername)) return alert('Guest names are reserved.');
        const normalizedNewUsername = normalizeDohbloxUsername(newUsername);
        if (currentUser.isOwner === true && normalizedNewUsername !== 'owner') return alert('The protected Owner username cannot be renamed.');
        if (currentUser.isOwner !== true && normalizedNewUsername === 'owner') return alert('Owner is a reserved protected account name.');

        if (await ensureDohbloxCloud(false) && dohbloxCloudAuth.currentUser && !dohbloxCloudAuth.currentUser.isAnonymous) {
            try {
                const key = normalizeDohbloxUsername(newUsername);
                if (key !== normalizeDohbloxUsername(currentUser.username)) {
                    const exists = await dohbloxCloudDb.collection('dohblox_users').where('normalizedUsername', '==', key).limit(1).get();
                    if (!exists.empty && exists.docs[0].id !== dohbloxCloudAuth.currentUser.uid) return alert('That username is already taken.');
                }
                currentUser.username = newUsername;
                currentUser.bio = newBio;
                await dohbloxCloudDb.collection('dohblox_users').doc(dohbloxCloudAuth.currentUser.uid).set(cloudProfilePayload(), { merge: true });
            } catch (err) {
                console.error('Profile update failed:', err);
                alert('Could not update the cloud profile. You may need to log in again before changing your username.');
                return;
            }
        } else {
            currentUser.username = newUsername;
            currentUser.bio = newBio;
        }
        saveToStorage();
        renderHeader();
        alert('Account settings saved!');
    }

    
    async function updatePassword() {
        const currentPass = document.getElementById('setting-current-password').value;
        const newPass = document.getElementById('setting-new-password').value;
        const confirmPass = document.getElementById('setting-confirm-password').value;
        if (!currentPass || !newPass || !confirmPass) return alert('Please fill in all password fields.');
        if (newPass !== confirmPass) return alert('New passwords do not match.');
        if (newPass.length < 6) return alert('New password must be at least 6 characters long.');
        if (!await ensureDohbloxCloud(true) || !dohbloxCloudAuth.currentUser || dohbloxCloudAuth.currentUser.isAnonymous) return alert('Log in to your cloud account first.');

        try {
            const user = dohbloxCloudAuth.currentUser;
            const credential = firebase.auth.EmailAuthProvider.credential(user.email, currentPass);
            await user.reauthenticateWithCredential(credential);
            await user.updatePassword(newPass);
            document.getElementById('setting-current-password').value = '';
            document.getElementById('setting-new-password').value = '';
            document.getElementById('setting-confirm-password').value = '';
            alert('Password updated securely in Firebase Authentication!');
        } catch (err) {
            console.warn('Password change failed:', err);
            alert('Current password is incorrect, or Firebase requires you to log in again.');
        }
    }

        function renderHeader() {
        if (isGuestUser(currentUser.username)) {
            currentUser.isMod = false;
        }

        document.getElementById('header-user-display').innerText = currentUser.username;
        document.getElementById('header-balance').innerText = currentUser.balance;
        
        const settingsBal = document.getElementById('settings-current-balance');
        const settingsMem = document.getElementById('settings-current-membership');
        if(settingsBal) settingsBal.innerText = currentUser.balance;
        if(settingsMem) settingsMem.innerText = currentUser.membership;

        const vIcon = document.getElementById('header-verified-icon');
        vIcon.style.display = (currentUser.isOwner === true) ? 'inline' : 'none';
        
        const navMod = document.getElementById('nav-mod-tab');
        const sidebarReports = document.getElementById('sidebar-reports-tab');
        const showMod = ((currentUser.isMod || currentUser.isOwner) && !isGuestUser(currentUser.username));
        if(navMod) navMod.style.display = showMod ? 'inline-block' : 'none';
        if(sidebarReports) sidebarReports.style.display = showMod ? 'block' : 'none';

        const isGuest = isGuestUser(currentUser.username);
        const navSettings = document.getElementById('nav-settings-tab');
        const sidebarSettings = document.getElementById('sidebar-settings-tab');
        if(navSettings) navSettings.style.display = isGuest ? 'none' : 'inline-block';
        if(sidebarSettings) sidebarSettings.style.display = isGuest ? 'none' : 'block';

        const btnLogin = document.getElementById('btn-login-modal');
        btnLogin.innerText = isGuest ? "Login" : `Logout`;
    }

    function renderGamesGrid() {
        const container = document.getElementById('games-grid-container');
        container.innerHTML = '';
        gamesDatabase.forEach((g,gi) => {
            const card = document.createElement('div');
            card.className = 'game-card';
            const safeId=String(g.id??gi).replace(/[^a-zA-Z0-9_-]/g,'_');
            const canvasId = `thumb-canvas-${safeId}-${gi}`;
            card.innerHTML = `
                <div class="card-banner"><canvas id="${canvasId}" width="260" height="120"></canvas></div>
                <strong style="color:#0055b3; font-size:13px; display:block; margin-top:4px;">${studioEsc(g.title)}</strong>
                ${g.type==='studio_published'?`<div style="font-size:10px;color:#777;margin-top:2px;">by ${studioEsc(g.owner||'Builder')}${g.public?' • Community':''}</div>`:''}
                <p style="margin: 4px 0 8px 0; color:#444; font-size:11px; line-height:1.2; min-height: 28px;">${studioEsc(g.description)}</p>
                <button class="btn-play">Play Game</button>`;
            card.querySelector('.btn-play').onclick=()=>launchGame(g.title,g.id);
            container.appendChild(card);
            setTimeout(() => drawGameThumbnail(canvasId, g.type, g.title, g), 20);
        });
    }

    function drawGameThumbnail(canvasId, type, title, gameRecord = null) {
        const canvas = document.getElementById(canvasId);
        if(!canvas) return;
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = '#7EC0EE';
        ctx.fillRect(0, 0, 260, 120);

        if(type === 'studio_published') {
            ctx.fillStyle = '#6fa7d8'; ctx.fillRect(0,0,260,120);
            ctx.fillStyle = '#4b8f42'; ctx.fillRect(0,82,260,38);
            const parts=(gameRecord&&gameRecord.studioWorld&&gameRecord.studioWorld.parts)||[];
            parts.filter(p=>!p.isSpawn).slice(0,35).forEach((p,i)=>{
                const x=130+(p.pos?.[0]||0)*2.1-(p.pos?.[2]||0)*.7;
                const y=82-(p.pos?.[1]||0)*2.2+(p.pos?.[2]||0)*.3;
                const w=Math.max(2,Math.min(45,(p.size?.[0]||4)*2.0));
                const h=Math.max(2,Math.min(38,(p.size?.[1]||2)*2.0));
                ctx.globalAlpha=1-Math.min(.75,p.transparency||0);ctx.fillStyle=p.color||'#aaa';ctx.fillRect(x-w/2,y-h,w,h);ctx.globalAlpha=1;
            });
            ctx.fillStyle='rgba(20,20,20,.65)';ctx.fillRect(0,0,260,25);ctx.fillStyle='#fff';ctx.font='bold 11px Arial';ctx.fillText('CREATED IN DOHBLOX STUDIO',8,17);
        } else if(type === 'crossroads') {
            ctx.fillStyle = '#4C9A2A';
            ctx.fillRect(0, 85, 260, 35);
            ctx.fillStyle = '#808080';
            ctx.fillRect(40, 25, 40, 60);
            ctx.fillStyle = '#CC0000';
            ctx.fillRect(150, 45, 55, 40);
            ctx.fillStyle = '#EEEE00';
            ctx.fillRect(165, 25, 25, 20);
        } else if(type === 'doh_hq') {
            // Thumbnail styled after the classic twin-tower HQ reference.
            ctx.fillStyle = '#d2d8da';
            ctx.fillRect(0, 0, 260, 120);
            ctx.fillStyle = '#4a9847';
            ctx.fillRect(0, 84, 260, 36);
            ctx.fillStyle = '#4f99ae';
            ctx.fillRect(0, 101, 260, 19);

            // Front roads / red path grid.
            ctx.fillStyle = '#666';
            ctx.fillRect(111, 78, 22, 42);
            ctx.fillRect(52, 89, 144, 10);
            ctx.fillStyle = '#b64b4b';
            ctx.fillRect(116, 78, 4, 42);
            ctx.fillRect(52, 93, 144, 3);

            // Low HQ block.
            ctx.fillStyle = '#155f86';
            ctx.fillRect(68, 51, 124, 34);
            ctx.fillStyle = '#b52a2a';
            ctx.fillRect(72, 53, 5, 32);
            ctx.fillRect(105, 53, 4, 32);
            ctx.fillRect(151, 53, 4, 32);
            ctx.fillRect(184, 53, 5, 32);
            ctx.fillRect(68, 55, 124, 4);
            ctx.fillStyle = '#111';
            ctx.fillRect(119, 67, 20, 18);

            // Twin blue-glass towers.
            ctx.fillStyle = '#155f86';
            ctx.fillRect(72, 19, 34, 64);
            ctx.fillRect(145, 8, 36, 75);
            ctx.fillRect(96, 36, 18, 47);
            ctx.fillRect(133, 30, 17, 53);

            // Dark mullion grids.
            ctx.strokeStyle = '#0b3448';
            ctx.lineWidth = 2;
            for(let y=24; y<82; y+=9){
                ctx.beginPath(); ctx.moveTo(72,y); ctx.lineTo(106,y); ctx.stroke();
            }
            for(let x=79; x<106; x+=8){
                ctx.beginPath(); ctx.moveTo(x,19); ctx.lineTo(x,83); ctx.stroke();
            }
            for(let y=14; y<82; y+=9){
                ctx.beginPath(); ctx.moveTo(145,y); ctx.lineTo(181,y); ctx.stroke();
            }
            for(let x=153; x<181; x+=8){
                ctx.beginPath(); ctx.moveTo(x,8); ctx.lineTo(x,83); ctx.stroke();
            }

            // Tall spires.
            ctx.fillStyle = '#0b2634';
            ctx.fillRect(78, 0, 5, 22);
            ctx.fillRect(159, 0, 6, 17);

            // Lawn sign.
            ctx.font = '900 12px Arial Black, Arial';
            ctx.textAlign = 'center';
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 3;
            ctx.strokeText('DOHBLOX', 213, 85);
            ctx.fillStyle = '#d41414';
            ctx.fillText('DOHBLOX', 213, 85);
            ctx.font = '900 10px Arial Black, Arial';
            ctx.strokeText('HQ', 213, 96);
            ctx.fillText('HQ', 213, 96);
            ctx.textAlign = 'start';
        } else if(type === 'natural_disaster') {
            ctx.fillStyle = '#79b9e8'; ctx.fillRect(0,0,260,120);
            ctx.fillStyle = '#3e87b8'; ctx.fillRect(0,88,260,32);
            ctx.fillStyle = '#5ca64d'; ctx.fillRect(45,58,170,38);
            ctx.fillStyle = '#9aa1a6'; ctx.fillRect(96,28,68,60);
            ctx.fillStyle = '#5f6970'; ctx.fillRect(105,18,50,12);
            ctx.fillStyle = '#f0f0f0'; ctx.fillRect(114,37,11,11); ctx.fillRect(135,37,11,11);
            ctx.fillStyle = '#6f7f88'; ctx.fillRect(8,78,30,10); ctx.fillRect(222,64,26,24);
            ctx.fillStyle = '#6cd4ff'; ctx.beginPath(); ctx.arc(218,28,17,0,Math.PI*2); ctx.fill();
            ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(202,30);ctx.lineTo(232,17);ctx.stroke();
        } else if(type === 'obby') {
            ctx.fillStyle = '#1c2d42';
            ctx.fillRect(0, 0, 260, 120);
            ctx.fillStyle = '#0055b3';
            ctx.fillRect(20, 90, 50, 12);
            ctx.fillStyle = '#ffcc00';
            ctx.fillRect(90, 70, 50, 12);
            ctx.fillStyle = '#d80000';
            ctx.fillRect(160, 50, 50, 12);
            ctx.fillStyle = '#00b33c';
            ctx.fillRect(210, 30, 40, 12);
        } else if(type === 'pizza') {
            ctx.fillStyle = '#d9cbb4';
            ctx.fillRect(0, 0, 260, 80);
            ctx.fillStyle = '#8c5230';
            ctx.fillRect(0, 80, 260, 40);
            ctx.fillStyle = '#a83232';
            ctx.fillRect(160, 30, 70, 50);
            ctx.fillStyle = '#222';
            ctx.fillRect(180, 50, 30, 30);
            ctx.fillStyle = '#5c3a21';
            ctx.fillRect(20, 60, 110, 20);
        } else {
            ctx.fillStyle = '#4C9A2A';
            ctx.fillRect(0, 75, 260, 45);
            ctx.strokeStyle = '#3b7821';
            ctx.lineWidth = 1;
            for(let x=0; x<260; x+=20) {
                ctx.beginPath(); ctx.moveTo(x, 75); ctx.lineTo(x, 120); ctx.stroke();
            }
        }

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px Arial';
        ctx.shadowColor = '#000000';
        ctx.shadowBlur = 3;
        ctx.fillText(title.toUpperCase(), 10, 20);
        ctx.shadowBlur = 0;
    }


    async function openLoginModal() {
        if (!isGuestUser(currentUser.username)) {
            await cloudLogout();
            currentUser = {
                username: 'Guest', balance: 0, isOwner: false, isMod: false, isBanned: false,
                membership: 'Member', badges: [], inventory: [], equipped: [],
                friends: [], followers: [], friendRequests: [], inbox: [],
                colors: { torso: 0x0055b3, limbs: 0xffcc00 }
            };
            localStorage.setItem('dohblox_user', JSON.stringify(currentUser));
            renderHeader();
            renderInbox();
            alert('Logged out successfully.');
            return;
        }
        ['login-email-input','login-password-input','signup-username-input','signup-email-input','signup-password-input','signup-confirm-password','forgot-email-input'].forEach(id => {
            const el = document.getElementById(id); if (el) el.value = '';
        });
        showMainLoginPanel();
        document.getElementById('login-modal').classList.remove('hidden');
    }

    function showMainLoginPanel() {
        const main = document.getElementById('login-main-panel');
        const signup = document.getElementById('signup-panel');
        const forgot = document.getElementById('forgot-password-panel');
        if (main) main.classList.remove('hidden');
        if (signup) signup.classList.add('hidden');
        if (forgot) forgot.classList.add('hidden');
    }

    function showSignupPanel() {
        const main = document.getElementById('login-main-panel');
        const signup = document.getElementById('signup-panel');
        const forgot = document.getElementById('forgot-password-panel');
        if (main) main.classList.add('hidden');
        if (signup) signup.classList.remove('hidden');
        if (forgot) forgot.classList.add('hidden');
    }

    function showForgotPasswordPanel() {
        const main = document.getElementById('login-main-panel');
        const signup = document.getElementById('signup-panel');
        const forgot = document.getElementById('forgot-password-panel');
        if (main) main.classList.add('hidden');
        if (signup) signup.classList.add('hidden');
        if (forgot) forgot.classList.remove('hidden');
    }

    function closeLoginModal() {
        document.getElementById('login-modal').classList.add('hidden');
        showMainLoginPanel();
    }

    function handleUsernameInput() {}

    function setLoginBusy(busy, message='') {
        const loginBtn = document.getElementById('btn-login-submit');
        const createBtn = document.getElementById('btn-create-account');
        const signupBtn = document.getElementById('btn-signup-submit');
        if (loginBtn) { loginBtn.disabled = !!busy; loginBtn.innerText = busy ? (message || 'Working...') : 'Sign In'; }
        if (createBtn) createBtn.disabled = !!busy;
        if (signupBtn) { signupBtn.disabled = !!busy; signupBtn.innerText = busy ? (message || 'Creating...') : 'Sign Up'; }
    }

    async function processLogin() {
        const email = document.getElementById('login-email-input').value.trim();
        const passVal = document.getElementById('login-password-input').value;
        if (!validRecoveryEmail(email)) return alert('Please enter your account email.');
        if (!passVal) return alert('Please enter your password.');
        setLoginBusy(true, 'Logging in...');
        try {
            const ok = await cloudLogin(email, passVal);
            if (!ok) return;
            renderHeader();
            renderInbox();
            closeLoginModal();
        } finally {
            setLoginBusy(false);
        }
    }

    async function processCreateAccount() {
        const username = document.getElementById('signup-username-input').value.trim();
        const email = document.getElementById('signup-email-input').value.trim();
        const passVal = document.getElementById('signup-password-input').value;
        const confirm = document.getElementById('signup-confirm-password').value;
        if (!username) return alert('Please choose a username.');
        if (isGuestUser(username)) return alert('Guest names are reserved. Choose a different username.');
        if (normalizeDohbloxUsername(username) === 'owner') return alert('Owner is a reserved protected account name.');
        if (!validRecoveryEmail(email)) return alert('Please enter a valid email address.');
        if (!passVal) return alert('Please enter a password.');
        if (passVal !== confirm) return alert('Passwords do not match.');
        setLoginBusy(true, 'Creating...');
        try {
            const ok = await cloudCreateAccount(username, email, passVal);
            if (!ok) return;
            renderHeader();
            renderInbox();
            closeLoginModal();
        } finally {
            setLoginBusy(false);
        }
    }

        function searchPlayerGlobal() {
        const val = document.getElementById('global-player-search').value.trim();
        if(!val) return;
        inspectReportedUser(val);
    }

    function createR6Character(torsoColor, limbColor) {
        const charGroup = new THREE.Group();
        const matHead = new THREE.MeshLambertMaterial({ color: 0xffcc00 });
        const matTorso = new THREE.MeshLambertMaterial({ color: torsoColor });
        const matLimbs = new THREE.MeshLambertMaterial({ color: limbColor });

        const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), matHead);
        head.position.y = 2.75;
        head.name = "head";

        const torso = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.0, 0.4), matTorso);
        torso.position.y = 1.9;
        torso.name = "torso";

        const leftArmGroup = new THREE.Group();
        leftArmGroup.position.set(-0.62, 2.3, 0);
        leftArmGroup.name = "leftArmGroup";
        const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.38, 1.0, 0.38), matLimbs);
        leftArm.position.y = -0.4;
        leftArm.name = "leftArm";
        leftArmGroup.add(leftArm);

        const rightArmGroup = new THREE.Group();
        rightArmGroup.position.set(0.62, 2.3, 0);
        rightArmGroup.name = "rightArmGroup";
        const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.38, 1.0, 0.38), matLimbs);
        rightArm.position.y = -0.4;
        rightArm.name = "rightArm";
        rightArmGroup.add(rightArm);

        const leftLegGroup = new THREE.Group();
        leftLegGroup.position.set(-0.21, 1.4, 0);
        leftLegGroup.name = "leftLegGroup";
        const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.38, 1.4, 0.38), matLimbs);
        leftLeg.position.y = -0.7;
        leftLeg.name = "leftLeg";
        leftLegGroup.add(leftLeg);

        const rightLegGroup = new THREE.Group();
        rightLegGroup.position.set(0.21, 1.4, 0);
        rightLegGroup.name = "rightLegGroup";
        const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.38, 1.4, 0.38), matLimbs);
        rightLeg.position.y = -0.7;
        rightLeg.name = "rightLeg";
        rightLegGroup.add(rightLeg);

        charGroup.add(head, torso, leftArmGroup, rightArmGroup, leftLegGroup, rightLegGroup);
        return charGroup;
    }

    function filterCatalog(cat) { renderCatalog(cat); }

    function renderCatalog(filter) {
        const container = document.getElementById('catalog-items-container');
        container.innerHTML = '';

        const items = (filter === 'all') ? catalogDatabase : catalogDatabase.filter(i => i.category === filter);

        items.forEach(item => {
            const el = document.createElement('div');
            el.className = 'catalog-item';
            
            const prevId = `cat-prev-${item.id}`;
            el.innerHTML = `
                <div class="catalog-3d-preview" id="${prevId}"></div>
                <strong>${item.name}</strong><br>
                <span style="color: #b8860b; font-weight: bold;">B ${item.price}</span><br><br>
                <button class="btn-style" onclick="buyCatalogItem(${item.id})">Buy Item</button>
            `;
            container.appendChild(el);

            setTimeout(() => render3DItemPreview(prevId, item.type), 50);
        });
    }

    function render3DItemPreview(containerId, itemType) {
        const c = document.getElementById(containerId);
        if(!c) return;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xf0f0f0);
        const camera = new THREE.PerspectiveCamera(50, c.clientWidth / c.clientHeight, 0.1, 100);
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(c.clientWidth, c.clientHeight);
        c.appendChild(renderer.domElement);

        const itemMesh = create3DAccessoryMesh(itemType);
        scene.add(itemMesh);

        const light = new THREE.DirectionalLight(0xffffff, 1);
        light.position.set(2, 3, 4);
        scene.add(light, new THREE.AmbientLight(0x777777));

        camera.position.set(0, 0.5, 2.2);

        function anim() {
            if(!document.getElementById(containerId)) return;
            requestAnimationFrame(anim);
            itemMesh.rotation.y += 0.02;
            renderer.render(scene, camera);
        }
        anim();
    }

    function create3DAccessoryMesh(type) {
        const group = new THREE.Group();
        if(type === 'top_hat') {
            const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.05, 16), new THREE.MeshLambertMaterial({ color: 0x111111 }));
            const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.6, 16), new THREE.MeshLambertMaterial({ color: 0x111111 }));
            crown.position.y = 0.3;
            group.add(brim, crown);
        } else if(type === 'crown') {
            const crownMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.35, 0.3, 8), new THREE.MeshLambertMaterial({ color: 0xffcc00 }));
            group.add(crownMesh);
        } else if(type === 'boombox') {
            const box = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.4, 0.3), new THREE.MeshLambertMaterial({ color: 0x222222 }));
            const spk1 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.32, 12), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
            spk1.rotation.x = Math.PI / 2; spk1.position.x = -0.25;
            const spk2 = spk1.clone(); spk2.position.x = 0.25;
            group.add(box, spk1, spk2);
        } else if(type === 'sunglasses') {
            const glass = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.15, 0.1), new THREE.MeshLambertMaterial({ color: 0x000000 }));
            group.add(glass);
        } else if(type === 'sword' || type === 'linked_sword') {
            const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.02), new THREE.MeshLambertMaterial({ color: 0xcccccc }));
            const hilt = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.05), new THREE.MeshLambertMaterial({ color: 0x8b4513 }));
            hilt.position.y = -0.55;
            group.add(blade, hilt);
        } else if(type === 'rocket_launcher') {
            const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.1, 12), new THREE.MeshLambertMaterial({ color: 0x335533 }));
            tube.rotation.x = Math.PI / 2;
            group.add(tube);
        } else if(type === 'timebomb') {
            const bomb = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 12), new THREE.MeshLambertMaterial({ color: 0x111111 }));
            group.add(bomb);
        } else if(type === 'slingshot') {
            const wood = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.08), new THREE.MeshLambertMaterial({ color: 0x8b4513 }));
            group.add(wood);
        } else if(type === 'trowel') {
            const blade = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.4, 0.02), new THREE.MeshLambertMaterial({ color: 0xaaaaaa }));
            group.add(blade);
        } else if(type === 'nds_apple') {
            group.add(new THREE.Mesh(new THREE.SphereGeometry(0.22,10,10),new THREE.MeshLambertMaterial({color:0xd22b2b})));
        } else if(type === 'nds_balloon') {
            const b=new THREE.Mesh(new THREE.SphereGeometry(0.35,12,12),new THREE.MeshLambertMaterial({color:0x44aa55}));b.position.y=.55;const s=new THREE.Mesh(new THREE.CylinderGeometry(.015,.015,1,5),new THREE.MeshBasicMaterial({color:0xdddddd}));group.add(b,s);
        } else if(type === 'nds_compass') {
            const c=new THREE.Mesh(new THREE.CylinderGeometry(.28,.28,.08,16),new THREE.MeshLambertMaterial({color:0xf2d33c}));c.rotation.x=Math.PI/2;group.add(c);
        }
        return group;
    }

    function buyCatalogItem(id) {
        const item = catalogDatabase.find(i => i.id === id);
        if(!item) return;

        if(!currentUser.inventory.some(i => i.id === item.id)) {
            if(currentUser.balance >= item.price) {
                currentUser.balance -= item.price;
                currentUser.inventory.push(item);
                saveToStorage();
                renderHeader();
                updateInventoryUI();
                alert(`Purchased ${item.name}!`);
            } else {
                alert("Not enough Dohbux!");
            }
        } else {
            alert("You already own this item!");
        }
    }

    function updateInventoryUI() {
        const container = document.getElementById('avatar-inventory-list');
        if(currentUser.inventory.length === 0) {
            container.innerHTML = '<p>Purchased catalog items appear here.</p>';
            return;
        }

        container.innerHTML = currentUser.inventory.map(i => {
            const isEquipped = currentUser.equipped.some(eq => eq.id === i.id);
            return `
                <div style="display:inline-block; border:1px solid #ccc; padding:8px; margin:4px; background:#fff; text-align:center;">
                    <strong>${i.name}</strong><br>
                    <button class="btn-style" onclick="toggleEquipItem(${i.id})" style="margin-top:4px;">
                        ${isEquipped ? 'Unequip' : 'Equip'}
                    </button>
                </div>
            `;
        }).join('');
    }

    function toggleEquipItem(id) {
        const item = currentUser.inventory.find(i => i.id === id);
        if(!item) return;

        const idx = currentUser.equipped.findIndex(i => i.id === id);
        if(idx >= 0) {
            currentUser.equipped.splice(idx, 1);
        } else {
            currentUser.equipped.push(item);
        }
        saveToStorage();
        updateInventoryUI();
        refreshAvatarAccessories(editorAvatarGroup);
        refreshAvatarAccessories(profileAvatarGroup);
    }

    function refreshAvatarAccessories(charGroup) {
        if(!charGroup) return;
        const toRemove = [];
        charGroup.children.forEach(c => {
            if(c.name.startsWith("acc_")) toRemove.push(c);
        });
        toRemove.forEach(c => charGroup.remove(c));

        currentUser.equipped.forEach(item => {
            const acc = create3DAccessoryMesh(item.type);
            acc.name = `acc_${item.id}`;

            if(item.type === 'top_hat' || item.type === 'crown') {
                acc.position.set(0, 3.15, 0);
            } else if(item.type === 'sunglasses') {
                acc.position.set(0, 2.75, 0.38);
            } else if(item.type === 'boombox') {
                acc.position.set(0, 1.9, -0.35);
            } else if(item.type === 'sword') {
                acc.position.set(0.62, 1.9, 0.2);
                acc.rotation.z = -Math.PI / 4;
            }
            charGroup.add(acc);
        });
    }

    function setAvatarColor(part, hex) {
        if(part === 'torso') currentUser.colors.torso = hex;
        if(part === 'limbs') currentUser.colors.limbs = hex;

        saveToStorage();
        [editorAvatarGroup, profileAvatarGroup].forEach(group => {
            if(!group) return;
            group.children.forEach(child => {
                if(child.name === 'torso') child.material.color.setHex(currentUser.colors.torso);
                if(child.name && (child.name.includes('Leg') || child.name.includes('Arm'))) {
                    child.children.forEach(sub => sub.material.color.setHex(currentUser.colors.limbs));
                }
            });
        });
    }

    function initAvatarEditor3D() {
        const c = document.getElementById('avatar-editor-3d');
        if(!c || c.clientWidth === 0) return;

        c.innerHTML = '';
        editorScene = new THREE.Scene();
        editorScene.background = new THREE.Color(0xeef5fc);
        editorCamera = new THREE.PerspectiveCamera(50, c.clientWidth / c.clientHeight, 0.1, 100);
        editorRenderer = new THREE.WebGLRenderer({ antialias: true });
        editorRenderer.setSize(c.clientWidth, c.clientHeight);
        c.appendChild(editorRenderer.domElement);

        const light = new THREE.DirectionalLight(0xffffff, 1);
        light.position.set(2, 5, 5);
        editorScene.add(light, new THREE.AmbientLight(0x666666));

        editorCamera.position.set(0, 1.8, 5.0);
        editorCamera.lookAt(0, 1.5, 0);

        editorAvatarGroup = createR6Character(currentUser.colors.torso, currentUser.colors.limbs);
        refreshAvatarAccessories(editorAvatarGroup);
        editorScene.add(editorAvatarGroup);

        function anim() {
            requestAnimationFrame(anim);
            if(editorAvatarGroup) editorAvatarGroup.rotation.y += 0.01;
            editorRenderer.render(editorScene, editorCamera);
        }
        anim();
    }

    function loadProfileView(username) {
        const foundView = document.getElementById('profile-found-view');
        const notFoundView = document.getElementById('profile-not-found-view');
        
        let targetUser = playersDatabase.find(p => p.username.toLowerCase() === username.toLowerCase());
        
        if (!targetUser && username.toLowerCase() === currentUser.username.toLowerCase()) {
            targetUser = currentUser;
        }

        if (!targetUser) {
            foundView.classList.add('hidden');
            notFoundView.classList.remove('hidden');
            return;
        }

        foundView.classList.remove('hidden');
        notFoundView.classList.add('hidden');

        document.getElementById('prof-username').innerText = targetUser.username;
        document.getElementById('prof-verified-icon').style.display = (targetUser.isOwner === true) ? 'inline' : 'none';
        document.getElementById('prof-role-text').innerText = targetUser.isOwner ? 'Owner' : (targetUser.isMod ? 'Administrator' : (targetUser.membership || 'Player'));
        document.getElementById('prof-status-text').innerText = targetUser.isBanned ? 'Banned' : 'Active';
        document.getElementById('prof-status-text').style.color = targetUser.isBanned ? 'red' : 'green';
        document.getElementById('prof-bio-text').innerText = targetUser.bio || 'Welcome to Dohblox!';

        const friendCount = targetUser.friends ? targetUser.friends.length : 0;
        const followerCount = targetUser.followers ? targetUser.followers.length : 0;
        document.getElementById('prof-friend-count').innerText = friendCount;
        document.getElementById('prof-follower-count').innerText = followerCount;

        const actionBtnsContainer = document.getElementById('profile-action-buttons');
        actionBtnsContainer.innerHTML = '';

        if (targetUser.username.toLowerCase() !== currentUser.username.toLowerCase() && !isGuestUser(currentUser.username)) {
            const isFriend = currentUser.friends && currentUser.friends.includes(targetUser.username);
            if (isFriend) {
                actionBtnsContainer.innerHTML = `<button class="btn-danger" onclick="unfriendUser('${targetUser.username}')">Unfriend</button>`;
            } else {
                actionBtnsContainer.innerHTML = `<button class="btn-mod" onclick="sendFriendRequest('${targetUser.username}')">Add Friend</button>`;
            }
        }

        const badgeContainer = document.getElementById('prof-badges-container');
        badgeContainer.innerHTML = '';
        if (targetUser.badges && targetUser.badges.length > 0) {
            targetUser.badges.forEach(b => {
                const badgePill = document.createElement('div');
                badgePill.className = 'badge-pill';
                badgePill.innerText = `🏆 ${b}`;
                badgeContainer.appendChild(badgePill);
            });
        }

        setTimeout(() => initProfile3D(), 10);
    }


    async function sendFriendRequest(targetName) {
        if (isGuestUser(currentUser.username)) return alert('Log in before sending friend requests.');
        const target = findCloudUserByName(targetName);
        if (!target || !target.uid) return alert('That player was not found in the cloud directory.');
        if (!dohbloxCloudCurrentUid || !await ensureDohbloxCloud(true)) return;
        if (target.uid === dohbloxCloudCurrentUid) return alert('You cannot friend yourself.');
        await dohbloxCloudDb.collection('dohblox_friend_requests').doc(target.uid).collection('requests').doc(dohbloxCloudCurrentUid).set({
            senderUid: dohbloxCloudCurrentUid, senderName: currentUser.username, createdAtMs: Date.now()
        });
        alert(`Friend request sent to ${targetName}!`);
    }

    
    async function unfriendUser(targetName) {
        const target = findCloudUserByName(targetName);
        if (target && target.uid && dohbloxCloudCurrentUid && await ensureDohbloxCloud(false)) {
            const pairId = makeFriendPairId(dohbloxCloudCurrentUid, target.uid);
            await dohbloxCloudDb.collection('dohblox_friendships').doc(pairId).delete().catch(() => {});
        } else {
            currentUser.friends = currentUser.friends.filter(f => f !== targetName);
            saveToStorage();
        }
        loadProfileView(targetName);
        alert(`You are no longer friends with ${targetName}.`);
    }

        function initProfile3D() {
        const c = document.getElementById('profile-avatar-container');
        if(!c || c.clientWidth === 0) return;

        c.innerHTML = '';
        profileScene = new THREE.Scene();
        profileScene.background = new THREE.Color(0xeef5fc);
        profileCamera = new THREE.PerspectiveCamera(50, c.clientWidth / c.clientHeight, 0.1, 100);
        profileRenderer = new THREE.WebGLRenderer({ antialias: true });
        profileRenderer.setSize(c.clientWidth, c.clientHeight);
        c.appendChild(profileRenderer.domElement);

        const light = new THREE.DirectionalLight(0xffffff, 1);
        light.position.set(2, 5, 5);
        profileScene.add(light, new THREE.AmbientLight(0x666666));

        profileCamera.position.set(0, 1.8, 5.0);
        profileCamera.lookAt(0, 1.5, 0);

        profileAvatarGroup = createR6Character(currentUser.colors.torso, currentUser.colors.limbs);
        refreshAvatarAccessories(profileAvatarGroup);
        profileScene.add(profileAvatarGroup);

        function anim() {
            requestAnimationFrame(anim);
            if(profileAvatarGroup) profileAvatarGroup.rotation.y += 0.01;
            profileRenderer.render(profileScene, profileCamera);
        }
        anim();
    }

    function renderReportsList() {
        const container = document.getElementById('reports-list-container');
        if(!container) return;
        if(activeReports.length === 0) {
            container.innerHTML = '<p>No pending user reports.</p>';
            return;
        }
        container.innerHTML = activeReports.map(r => `
            <div style="border:1px solid #ccc; padding:8px; margin-bottom:6px; background:#fff; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <strong>Reported: ${r.reportedUser}</strong><br>
                    <small>By: ${r.reporter} | Reason: ${r.reason}</small>
                </div>
                <button class="btn-style" onclick="inspectReportedUser('${r.reportedUser}')">Inspect</button>
            </div>
        `).join('');
    }

    function inspectReportedUser(username) {
        viewingProfileUser = username;
        switchTab('profile');
        loadProfileView(username);
    }

    function searchProfileFromMod() {
        const val = document.getElementById('mod-search-input').value.trim();
        if(!val) return;
        inspectReportedUser(val);
    }

    function openPaymentModal(itemName, price) {
        currentPendingPurchase = { name: itemName, price: price };
        document.getElementById('modal-item-title').innerText = `Purchase: ${itemName}`;
        document.getElementById('modal-item-price').innerText = `$${price.toFixed(2)}`;
        document.getElementById('payment-modal').classList.remove('hidden');
    }

    function closePaymentModal() {
        document.getElementById('payment-modal').classList.add('hidden');
        currentPendingPurchase = null;
    }

    function confirmPaymentSimulation() {
        if(!currentPendingPurchase) return;
        
        if(currentPendingPurchase.name.includes("Dohbux Pack")) {
            const amount = parseInt(currentPendingPurchase.name.replace(/[^0-9]/g, ''));
            currentUser.balance += amount;
        } else {
            currentUser.membership = currentPendingPurchase.name;
        }

        saveToStorage();
        renderHeader();
        closePaymentModal();
        alert("Transaction completed successfully! Item granted.");
    }

    /* GAME ENGINE & PHYSICS CONTROLS */
    let playerPos = { x: 0, y: 0, z: 0 };
    let playerVelocityY = 0;
    let isGrounded = true;
    let keysPressed = {};
    let cameraPitch = 0.3;
    let cameraYaw = 0;
    let gameColliders = [];
    let walkCycleTimer = 0;
    let worldLastFrameTime = performance.now();

    function setupKeyboardAndMouseListeners() {
        window.addEventListener('keydown', (e) => {
            if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
            keysPressed[e.code] = true;
            initAudioContext();
            if (e.code === 'Space' && isGrounded) {
                playerVelocityY = (isNaturalDisasterActive() && ndsBalloonActive) ? 0.39 : 0.28;
                isGrounded = false;
                playJumpSound();
            }
            if (e.code >= 'Digit1' && e.code <= 'Digit6') {
                selectHotbarSlot(parseInt(e.code.replace('Digit','')) - 1);
            }
            if (e.code === 'Escape') toggleInGameMenu();
            if (e.code === 'KeyE') performContextInteraction();
        });
        window.addEventListener('keyup', (e) => { keysPressed[e.code] = false; });

        const canvasContainer = document.getElementById('game-canvas-container');
        canvasContainer.addEventListener('contextmenu', e => e.preventDefault());

        canvasContainer.addEventListener('pointerdown', (e) => {
            if (e.target.closest('#game-chat-overlay') || e.target.closest('#roblox-hud-bottom')) return;
            initAudioContext();
            if (e.button === 2) {
                e.preventDefault();
                isMouseDownForCamera = true;
                lastMousePos = { x:e.clientX, y:e.clientY };
                try { canvasContainer.setPointerCapture(e.pointerId); } catch (_) {}
            } else if (e.button === 0) {
                performAttack();
            }
        });

        window.addEventListener('pointermove', (e) => {
            if (!isMouseDownForCamera) return;
            const dx=e.clientX-lastMousePos.x, dy=e.clientY-lastMousePos.y;
            cameraYaw -= dx * 0.006;
            cameraPitch = Math.max(-0.2, Math.min(1.2, cameraPitch + dy * 0.006));
            lastMousePos = { x:e.clientX, y:e.clientY };
        });
        window.addEventListener('pointerup', (e) => {
            if (e.button === 2) isMouseDownForCamera = false;
        });
        window.addEventListener('blur', () => { isMouseDownForCamera = false; });
    }

    function isCrossroadsActive() {
        return !!activeGameTitle && (activeGameTitle.includes("Crossroads") || activeGameTitle.includes("Dohblox HQ") || (activeGameRecord && activeGameRecord.type === 'studio_published' && ['sword','classic'].includes((activeGameRecord.studioWorld&&activeGameRecord.studioWorld.starterGear)||'none')));
    }

    function isCrossroadsMapActive() {
        return !!activeGameTitle && activeGameTitle.includes("Crossroads");
    }

    function isDohbloxHQActive() {
        return !!activeGameTitle && activeGameTitle.includes("Dohblox HQ");
    }

    function isPizzaPlaceActive() {
        return !!activeGameTitle && activeGameTitle.includes("Pizza Place");
    }

    function getCurrentGameSpawnPosition() {
        if (activeGameRecord && activeGameRecord.type === 'studio_published' && studioPublishedSpawn) return { ...studioPublishedSpawn };
        if (isNaturalDisasterActive()) return ndsPhase === 'prep' || ndsPhase === 'disaster' ? ndsIslandSpawn() : ndsLobbySpawn();
        if (isDohbloxHQActive()) return { x: 0, y: 3, z: 55 };
        if (isPizzaPlaceActive()) return { x: 0, y: 3, z: 48 };
        if (isCrossroadsMapActive()) return { x: 0, y: 3, z: 0 };
        return { x: 0, y: 10, z: 0 };
    }

    function nextCrossroadsObjectId(prefix) {
        crossroadsObjectCounter++;
        return `${prefix}_${localSessionId}_${Date.now()}_${crossroadsObjectCounter}`;
    }

    function getCrossroadsAimDirection(flatten = false) {
        let dir = new THREE.Vector3(Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
        if (gameCamera) {
            gameCamera.getWorldDirection(dir);
        }
        if (flatten) dir.y = 0;
        if (dir.lengthSq() < 0.0001) dir.set(0, 0, -1);
        return dir.normalize();
    }

    function getCrossroadsCooldownRemaining(weaponType) {
        const cooldown = CROSSROADS_COOLDOWNS[weaponType] || 0;
        const lastUse = crossroadsLastUseTimes[weaponType] || 0;
        return Math.max(0, cooldown - (Date.now() - lastUse));
    }

    function refreshCrossroadsCooldownUI() {
        if (!isCrossroadsActive()) return;
        for (let i = 0; i < 6; i++) {
            const item = inGameHotbar[i];
            const lbl = document.getElementById(`slot-lbl-${i}`);
            if (!item || !lbl) continue;
            const remaining = getCrossroadsCooldownRemaining(item.type);
            if (remaining > 0 && (item.type === 'rocket_launcher' || item.type === 'timebomb' || item.type === 'trowel')) {
                lbl.innerText = `${item.name} ${(remaining / 1000).toFixed(1)}s`;
            } else {
                lbl.innerText = item.name;
            }
        }
    }

    function startCrossroadsCooldownUI() {
        if (crossroadsCooldownUiTimer) clearInterval(crossroadsCooldownUiTimer);
        crossroadsCooldownUiTimer = setInterval(refreshCrossroadsCooldownUI, 100);
        refreshCrossroadsCooldownUI();
    }

    function handleCrossroadsSwordSwing(payload) {
        if (!payload || !payload.position || !payload.direction || crossroadsRespawning) return;

        const origin = new THREE.Vector3(payload.position.x, payload.position.y, payload.position.z);
        const dir = new THREE.Vector3(payload.direction.x, 0, payload.direction.z);
        if (dir.lengthSq() < 0.0001) return;
        dir.normalize();

        const localCenter = new THREE.Vector3(playerPos.x, playerPos.y + 1.4, playerPos.z);
        const toPlayer = localCenter.clone().sub(origin);
        const distance = toPlayer.length();
        if (distance > 4.2 || distance < 0.05) return;

        const flatToPlayer = new THREE.Vector3(toPlayer.x, 0, toPlayer.z);
        if (flatToPlayer.lengthSq() < 0.0001) return;
        flatToPlayer.normalize();

        if (dir.dot(flatToPlayer) >= 0.35 && Math.abs(toPlayer.y) <= 2.8) {
            applyCrossroadsDamage(30);
        }
    }

    function fireCrossroadsProjectile(type) {
        if (!gameScene || !gameCamera) return;

        const dir = getCrossroadsAimDirection(false);
        if (type === 'slingshot') dir.y += 0.08;
        dir.normalize();

        const speed = type === 'rocket' ? 34 : 27;
        const spawn = new THREE.Vector3(playerPos.x, playerPos.y + 1.65, playerPos.z)
            .add(dir.clone().multiplyScalar(1.5));

        const data = {
            id: nextCrossroadsObjectId(type),
            type: type,
            ownerId: localSessionId,
            position: { x: spawn.x, y: spawn.y, z: spawn.z },
            velocity: { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed }
        };

        spawnCrossroadsProjectile(data, true);
    }

    function spawnCrossroadsProjectile(data, shouldBroadcast) {
        if (!gameScene || !data || !data.position || !data.velocity) return;
        if (crossroadsProjectiles.some(p => p.id === data.id)) return;

        const type = data.type === 'slingshot' ? 'slingshot' : 'rocket';
        let mesh;

        if (type === 'rocket') {
            const group = new THREE.Group();
            const body = new THREE.Mesh(
                new THREE.CylinderGeometry(0.13, 0.13, 0.72, 10),
                new THREE.MeshLambertMaterial({ color: 0x666666 })
            );
            body.rotation.x = Math.PI / 2;
            const nose = new THREE.Mesh(
                new THREE.ConeGeometry(0.14, 0.25, 10),
                new THREE.MeshLambertMaterial({ color: 0xcc2200 })
            );
            nose.rotation.x = -Math.PI / 2;
            nose.position.z = -0.48;
            group.add(body, nose);
            mesh = group;
        } else {
            mesh = new THREE.Mesh(
                new THREE.SphereGeometry(0.22, 10, 10),
                new THREE.MeshLambertMaterial({ color: 0x333333 })
            );
        }

        mesh.position.set(data.position.x, data.position.y, data.position.z);
        gameScene.add(mesh);

        const projectile = {
            id: data.id || nextCrossroadsObjectId(type),
            type: type,
            ownerId: data.ownerId || localSessionId,
            mesh: mesh,
            velocity: new THREE.Vector3(data.velocity.x, data.velocity.y, data.velocity.z),
            createdAt: performance.now(),
            lastWallId: null,
            lastWallHitAt: 0,
            reflected: false
        };

        crossroadsProjectiles.push(projectile);

        if (shouldBroadcast) {
            sendNetworkMessage('CROSSROADS_PROJECTILE', {
                id: projectile.id,
                type: projectile.type,
                position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
                velocity: { x: projectile.velocity.x, y: projectile.velocity.y, z: projectile.velocity.z }
            });
        }
    }

    function placeCrossroadsBomb() {
        const dir = getCrossroadsAimDirection(true);
        const pos = new THREE.Vector3(playerPos.x, playerPos.y + 0.38, playerPos.z)
            .add(dir.multiplyScalar(2.1));

        createCrossroadsBomb({
            id: nextCrossroadsObjectId('bomb'),
            ownerId: localSessionId,
            position: { x: pos.x, y: pos.y, z: pos.z },
            detonateAt: Date.now() + 3000
        }, true);
    }

    function createCrossroadsBomb(data, shouldBroadcast) {
        if (!gameScene || !data || !data.position) return;
        if (crossroadsBombs.some(b => b.id === data.id)) return;

        const group = new THREE.Group();
        const core = new THREE.Mesh(
            new THREE.SphereGeometry(0.38, 12, 12),
            new THREE.MeshLambertMaterial({ color: 0x151515 })
        );
        const fuse = new THREE.Mesh(
            new THREE.CylinderGeometry(0.035, 0.035, 0.35, 6),
            new THREE.MeshLambertMaterial({ color: 0x8b5a2b })
        );
        fuse.position.y = 0.42;
        fuse.rotation.z = 0.35;
        const fuseTip = new THREE.Mesh(
            new THREE.SphereGeometry(0.075, 8, 8),
            new THREE.MeshBasicMaterial({ color: 0xff3300 })
        );
        fuseTip.position.set(0.06, 0.60, 0);
        group.add(core, fuse, fuseTip);
        group.position.set(data.position.x, data.position.y, data.position.z);
        gameScene.add(group);

        const bomb = {
            id: data.id || nextCrossroadsObjectId('bomb'),
            ownerId: data.ownerId || localSessionId,
            mesh: group,
            core: core,
            fuseTip: fuseTip,
            detonateAt: Number(data.detonateAt) || (Date.now() + 3000)
        };
        crossroadsBombs.push(bomb);

        if (shouldBroadcast) {
            sendNetworkMessage('CROSSROADS_TIMEBOMB', {
                id: bomb.id,
                position: { x: group.position.x, y: group.position.y, z: group.position.z },
                detonateAt: bomb.detonateAt
            });
        }
    }

    function placeCrossroadsWall() {
        const dir = getCrossroadsAimDirection(true);
        const pos = new THREE.Vector3(playerPos.x, playerPos.y + 2.25, playerPos.z)
            .add(dir.multiplyScalar(4.2));

        createCrossroadsWall({
            id: nextCrossroadsObjectId('wall'),
            ownerId: localSessionId,
            position: { x: pos.x, y: pos.y, z: pos.z },
            rotationY: cameraYaw,
            expiresAt: Date.now() + 15000
        }, true);
    }

    function createCrossroadsWall(data, shouldBroadcast) {
        if (!gameScene || !data || !data.position) return;
        if (crossroadsWalls.some(w => w.id === data.id)) return;

        const wall = new THREE.Group();
        const brickMat = new THREE.MeshLambertMaterial({ color: 0x8a8a8a });
        const rows = 4;
        const cols = 6;
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const brick = new THREE.Mesh(
                    new THREE.BoxGeometry(1.18, 1.0, 0.58),
                    brickMat.clone()
                );
                const stagger = (row % 2) * 0.58;
                brick.position.set((col - 2.5) * 1.16 + stagger - 0.29, (row - 1.5) * 0.98, 0);
                wall.add(brick);
            }
        }

        wall.position.set(data.position.x, data.position.y, data.position.z);
        wall.rotation.y = Number(data.rotationY) || 0;
        gameScene.add(wall);

        const wallData = {
            id: data.id || nextCrossroadsObjectId('wall'),
            ownerId: data.ownerId || localSessionId,
            mesh: wall,
            rotationY: wall.rotation.y,
            expiresAt: Number(data.expiresAt) || (Date.now() + 15000)
        };
        crossroadsWalls.push(wallData);

        if (shouldBroadcast) {
            sendNetworkMessage('CROSSROADS_WALL', {
                id: wallData.id,
                position: { x: wall.position.x, y: wall.position.y, z: wall.position.z },
                rotationY: wallData.rotationY,
                expiresAt: wallData.expiresAt
            });
        }
    }

    function removeCrossroadsProjectile(projectile) {
        if (!projectile) return;
        if (projectile.mesh && projectile.mesh.parent) projectile.mesh.parent.remove(projectile.mesh);
        const index = crossroadsProjectiles.indexOf(projectile);
        if (index >= 0) crossroadsProjectiles.splice(index, 1);
    }

    function createCrossroadsExplosion(position, kind) {
        if (!gameScene) return;

        const radius = kind === 'bomb' ? 6.5 : (kind === 'rocket' ? 5.0 : 3.2);
        const maxDamage = kind === 'bomb' ? 70 : (kind === 'rocket' ? 52 : 26);
        const color = kind === 'slingshot' ? 0xffcc33 : 0xff5a16;

        const blast = new THREE.Mesh(
            new THREE.SphereGeometry(1, 16, 12),
            new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.82 })
        );
        blast.position.copy(position);
        blast.scale.setScalar(0.2);
        gameScene.add(blast);
        crossroadsEffects.push({ mesh: blast, createdAt: performance.now(), duration: 380, radius: radius });

        playExplosionSound();
        damageDohbloxHQStructures(position, kind);

        if (!crossroadsRespawning) {
            const localCenter = new THREE.Vector3(playerPos.x, playerPos.y + 1.2, playerPos.z);
            const distance = localCenter.distanceTo(position);
            if (distance <= radius) {
                const falloff = Math.max(0.35, 1 - (distance / radius) * 0.65);
                applyCrossroadsDamage(Math.round(maxDamage * falloff));
            }
        }
    }

    function applyCrossroadsDamage(amount) {
        if (!isCrossroadsActive() || crossroadsRespawning || amount <= 0) return;
        if (Date.now() < localSpawnShieldUntil) return;
        updateHealthUI(playerHealth - amount);

        if (playerHealth <= 0) {
            crossroadsRespawning = true;
            setTimeout(() => {
                if (!isCrossroadsActive()) {
                    crossroadsRespawning = false;
                    return;
                }
                playerPos = getCurrentGameSpawnPosition();
                playerVelocityY = 0;
                updateHealthUI(100);
                activateLocalSpawnShield(4500, true);
                crossroadsRespawning = false;
            }, 750);
        }
    }

    function projectileHitsWorld(position, radius) {
        for (const collider of gameColliders) {
            const expanded = collider.clone().expandByScalar(radius);
            if (expanded.containsPoint(position)) return true;
        }
        return false;
    }

    function projectileHitsAnyPlayer(projectile, position, radius) {
        const localCenter = new THREE.Vector3(playerPos.x, playerPos.y + 1.35, playerPos.z);
        const canHitLocal = projectile.ownerId !== localSessionId || projectile.reflected;
        if (canHitLocal && localCenter.distanceTo(position) <= 1.0 + radius) return true;

        for (const id in remotePlayers) {
            const p = remotePlayers[id];
            if (!p || !p.mesh) continue;
            if (id === projectile.ownerId && !projectile.reflected) continue;
            const remoteCenter = p.mesh.position.clone().add(new THREE.Vector3(0, 1.35, 0));
            if (remoteCenter.distanceTo(position) <= 1.0 + radius) return true;
        }
        return false;
    }

    function tryDeflectProjectileWithWall(projectile, nowMs) {
        const projectileRadius = projectile.type === 'rocket' ? 0.34 : 0.24;
        for (const wall of crossroadsWalls) {
            if (!wall.mesh) continue;
            const wallBox = new THREE.Box3().setFromObject(wall.mesh).expandByScalar(projectileRadius);
            if (!wallBox.containsPoint(projectile.mesh.position)) continue;

            if (projectile.lastWallId === wall.id && nowMs - projectile.lastWallHitAt < 180) {
                return true;
            }

            const normal = new THREE.Vector3(Math.sin(wall.rotationY), 0, Math.cos(wall.rotationY)).normalize();
            projectile.velocity.reflect(normal).multiplyScalar(1.03);
            projectile.reflected = true;
            projectile.lastWallId = wall.id;
            projectile.lastWallHitAt = nowMs;

            const pushDir = projectile.velocity.clone().normalize();
            projectile.mesh.position.add(pushDir.multiplyScalar(0.8));
            return true;
        }
        return false;
    }

    function updateCrossroadsCombat() {
        if (!isCrossroadsActive() || !gameScene) {
            crossroadsCombatLastTime = performance.now();
            return;
        }

        const nowPerf = performance.now();
        const dt = Math.min(0.05, Math.max(0.001, (nowPerf - crossroadsCombatLastTime) / 1000));
        crossroadsCombatLastTime = nowPerf;
        const nowDate = Date.now();

        for (let i = crossroadsProjectiles.length - 1; i >= 0; i--) {
            const projectile = crossroadsProjectiles[i];
            if (!projectile.mesh) {
                crossroadsProjectiles.splice(i, 1);
                continue;
            }

            if (projectile.type === 'slingshot') projectile.velocity.y -= 13.5 * dt;
            projectile.mesh.position.add(projectile.velocity.clone().multiplyScalar(dt));

            if (projectile.type === 'rocket' && projectile.mesh.quaternion) {
                const lookTarget = projectile.mesh.position.clone().add(projectile.velocity);
                projectile.mesh.lookAt(lookTarget);
            }

            if (nowPerf - projectile.createdAt > 6500) {
                removeCrossroadsProjectile(projectile);
                continue;
            }

            if (tryDeflectProjectileWithWall(projectile, nowPerf)) continue;

            const hitRadius = projectile.type === 'rocket' ? 0.34 : 0.24;
            const hitPlayer = projectileHitsAnyPlayer(projectile, projectile.mesh.position, hitRadius);
            const hitWorld = projectileHitsWorld(projectile.mesh.position, hitRadius);

            if (hitPlayer || hitWorld) {
                const impactPosition = projectile.mesh.position.clone();
                const kind = projectile.type;
                removeCrossroadsProjectile(projectile);
                createCrossroadsExplosion(impactPosition, kind);
            }
        }

        for (let i = crossroadsBombs.length - 1; i >= 0; i--) {
            const bomb = crossroadsBombs[i];
            if (!bomb.mesh) {
                crossroadsBombs.splice(i, 1);
                continue;
            }

            const remaining = bomb.detonateAt - nowDate;
            const blink = Math.floor(Math.max(0, remaining) / 180) % 2 === 0;
            if (bomb.fuseTip && bomb.fuseTip.material) {
                bomb.fuseTip.material.color.setHex(blink ? 0xffff00 : 0xff2200);
            }
            if (bomb.core && bomb.core.material && remaining < 900) {
                bomb.core.material.color.setHex(blink ? 0x552222 : 0x151515);
            }

            if (remaining <= 0) {
                const pos = bomb.mesh.position.clone();
                if (bomb.mesh.parent) bomb.mesh.parent.remove(bomb.mesh);
                crossroadsBombs.splice(i, 1);
                createCrossroadsExplosion(pos, 'bomb');
            }
        }

        for (let i = crossroadsWalls.length - 1; i >= 0; i--) {
            const wall = crossroadsWalls[i];
            if (nowDate >= wall.expiresAt) {
                if (wall.mesh && wall.mesh.parent) wall.mesh.parent.remove(wall.mesh);
                crossroadsWalls.splice(i, 1);
            }
        }

        for (let i = crossroadsEffects.length - 1; i >= 0; i--) {
            const effect = crossroadsEffects[i];
            const t = (nowPerf - effect.createdAt) / effect.duration;
            if (t >= 1) {
                if (effect.mesh && effect.mesh.parent) effect.mesh.parent.remove(effect.mesh);
                crossroadsEffects.splice(i, 1);
                continue;
            }
            const scale = 0.2 + effect.radius * t;
            effect.mesh.scale.setScalar(scale);
            if (effect.mesh.material) effect.mesh.material.opacity = 0.82 * (1 - t);
        }
    }

    function resetCrossroadsCombatState() {
        crossroadsProjectiles = [];
        crossroadsWalls = [];
        crossroadsBombs = [];
        crossroadsEffects = [];
        crossroadsLastUseTimes = Object.create(null);
        if (crossroadsCooldownUiTimer) {
            clearInterval(crossroadsCooldownUiTimer);
            crossroadsCooldownUiTimer = null;
        }
        crossroadsCombatLastTime = performance.now();
        crossroadsRespawning = false;
    }

    function cleanupCrossroadsCombat() {
        const collections = [crossroadsProjectiles, crossroadsWalls, crossroadsBombs, crossroadsEffects];
        collections.forEach(collection => {
            collection.forEach(item => {
                const mesh = item.mesh;
                if (mesh && mesh.parent) mesh.parent.remove(mesh);
            });
        });
        resetCrossroadsCombatState();
    }

    let hqBreakLastAt = 0;
    let pizzaInteractables = [];
    let pizzaJobStage = 'cashier';
    let pizzaDeliveryTarget = 'A1';
    let pizzaSupplierLoaded = false;
    let pizzaCompletedOrders = 0;
    let pizzaCustomers = [];
    let pizzaCustomerCounter = 0;
    let pizzaLastCustomerSpawnAt = 0;
    let pizzaActiveOrderCustomerId = null;
    let pizzaCurrentOrderName = 'Cheese';
    const PIZZA_CUSTOMER_SPAWN_MS = 6500;
    const PIZZA_CUSTOMER_MAX = 5;

    let pizzaHouseOutlines = {};
    let pizzaHouseDropPoints = {};
    let pizzaDeliveryCar = null;
    let pizzaDeliveryBike = null;
    let pizzaInCar = false;
    let pizzaInBike = false;
    let pizzaCarYaw = Math.PI;
    let pizzaBikeYaw = Math.PI;
    let pizzaDeliveryDriveStarted = false;
    let pizzaJobAnimation = null;
    let pizzaPrepPizzaVisual = null;
    let pizzaOvenPizzaVisual = null;
    let pizzaBoxVisual = null;
    let pizzaBoxLidVisual = null;
    let pizzaDeliveryBoxVisual = null;
    let pizzaOvenGlowVisuals = [];
    let pizzaHudEl = null;
    let pizzaShopEl = null;
    let pizzaLocalOrderId = null;
    let pizzaRemoteOrders = Object.create(null);
    const PIZZA_CAR_PARK = { x: 43, z: 24 };
    const PIZZA_BIKE_PARK = { x: 32, z: 24 };

    function ensurePizzaProgress() {
        if (!currentUser) return;
        if (!Number.isFinite(currentUser.pizzaDohbux)) currentUser.pizzaDohbux = 0;
        if (!currentUser.pizzaUpgrades || typeof currentUser.pizzaUpgrades !== 'object') currentUser.pizzaUpgrades = {};
        if (typeof currentUser.pizzaUpgrades.prep2x !== 'boolean') currentUser.pizzaUpgrades.prep2x = false;
        if (typeof currentUser.pizzaUpgrades.oven2x !== 'boolean') currentUser.pizzaUpgrades.oven2x = false;
        if (typeof currentUser.pizzaUpgrades.boxing2x !== 'boolean') currentUser.pizzaUpgrades.boxing2x = false;
    }

    function isPizzaWeekend() {
        const d = new Date().getDay();
        return d === 0 || d === 6;
    }

    function pizzaPayMultiplier() { return isPizzaWeekend() ? 2 : 1; }

    function getLocalPizzaOrderNetworkState() {
        if (!isPizzaPlaceActive() || pizzaJobStage === 'cashier' || !pizzaLocalOrderId) return null;
        return {
            active: true,
            orderId: pizzaLocalOrderId,
            orderName: pizzaCurrentOrderName,
            stage: pizzaJobStage,
            target: pizzaDeliveryTarget
        };
    }

    function broadcastPizzaOrderStatus() {
        if (!isPizzaPlaceActive()) return;
        const state = getLocalPizzaOrderNetworkState();
        sendNetworkMessage('PIZZA_ORDER_STATUS', state || { active:false });
    }

    function updateRemotePizzaOrder(id, username, state) {
        if (!state || !state.active) {
            delete pizzaRemoteOrders[id];
        } else {
            pizzaRemoteOrders[id] = {
                username: username || 'Player',
                orderId: state.orderId || '',
                orderName: state.orderName || 'Pizza',
                stage: state.stage || 'prep',
                target: state.target || '',
                updatedAt: Date.now()
            };
        }
        updatePizzaHud();
    }

    function activePizzaCrewOrderCount() {
        const now = Date.now();
        for (const id of Object.keys(pizzaRemoteOrders)) {
            if (now - (pizzaRemoteOrders[id].updatedAt || 0) > 5000) delete pizzaRemoteOrders[id];
        }
        return Object.keys(pizzaRemoteOrders).length + (getLocalPizzaOrderNetworkState() ? 1 : 0);
    }

    function ensurePizzaHud() {
        const host = document.getElementById('game-canvas-container');
        if (!host) return;
        if (!pizzaHudEl) {
            pizzaHudEl = document.createElement('div');
            pizzaHudEl.id = 'pizza-job-hud';
            pizzaHudEl.style.cssText = 'position:absolute;top:58px;left:50%;transform:translateX(-50%);z-index:2004;background:rgba(20,20,20,.82);color:#fff;border:2px solid #f1c232;border-radius:6px;padding:7px 12px;font:bold 12px Arial;pointer-events:none;text-align:center;min-width:230px;box-shadow:0 2px 8px rgba(0,0,0,.45)';
            host.appendChild(pizzaHudEl);
        }
        pizzaHudEl.style.display = isPizzaPlaceActive() ? 'block' : 'none';
        updatePizzaHud();
    }

    function updatePizzaHud() {
        if (!pizzaHudEl || !isPizzaPlaceActive()) return;
        ensurePizzaProgress();
        const weekend = isPizzaWeekend() ? ' <span style="color:#ffd966">WEEKEND 2× PAY</span>' : '';
        let task = pizzaJobStage.toUpperCase();
        if (pizzaJobStage === 'delivery') {
            const ride = pizzaInBike ? ' • RIDING BIKE' : pizzaInCar ? ' • DRIVING CAR' : ' • WALK / CAR / BIKE';
            task = `DELIVER TO ${pizzaDeliveryTarget}${ride}`;
        }
        const crewOrders = activePizzaCrewOrderCount();
        pizzaHudEl.innerHTML = `Pizza Dohbux: <span style="color:#7CFC00">B ${currentUser.pizzaDohbux}</span>${weekend}<br><span style="font-size:10px;color:#ddd">Job: ${task} • Crew orders active: ${crewOrders}</span>`;
    }

    function ensurePizzaShopUI() {
        const host = document.getElementById('game-canvas-container');
        if (!host || pizzaShopEl) return;
        pizzaShopEl = document.createElement('div');
        pizzaShopEl.id = 'pizza-upgrade-shop';
        pizzaShopEl.style.cssText = 'position:absolute;inset:0;z-index:2600;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;pointer-events:auto';
        pizzaShopEl.innerHTML = `
            <div style="width:min(390px,90vw);background:#f4ead7;border:3px solid #8e4f42;border-radius:8px;padding:16px;color:#222;font:12px Arial;box-shadow:0 8px 30px rgba(0,0,0,.55)">
                <div style="font:bold 20px Arial;color:#b52e2e;margin-bottom:4px">Pizza Job Upgrades</div>
                <div id="pizza-shop-balance" style="font-weight:bold;margin-bottom:12px"></div>
                <button id="pizza-buy-prep" class="btn-style" style="width:100%;margin:4px 0;padding:9px" onclick="buyPizzaUpgrade('prep2x')">2× Prep Speed — B 80</button>
                <button id="pizza-buy-oven" class="btn-style" style="width:100%;margin:4px 0;padding:9px" onclick="buyPizzaUpgrade('oven2x')">2× Oven Speed — B 120</button>
                <button id="pizza-buy-boxing" class="btn-style" style="width:100%;margin:4px 0;padding:9px" onclick="buyPizzaUpgrade('boxing2x')">2× Boxing Speed — B 100</button>
                <div style="font-size:10px;color:#555;margin-top:8px">Pizza Dohbux are job money only. They do not change your normal Dohblox balance.</div>
                <button class="btn-style" style="width:100%;margin-top:12px" onclick="closePizzaUpgradeShop()">Close</button>
            </div>`;
        host.appendChild(pizzaShopEl);
    }

    function refreshPizzaShopUI() {
        if (!pizzaShopEl) return;
        ensurePizzaProgress();
        const bal = pizzaShopEl.querySelector('#pizza-shop-balance');
        if (bal) bal.textContent = `Pizza Dohbux: B ${currentUser.pizzaDohbux}`;
        const map = [['prep2x','pizza-buy-prep'],['oven2x','pizza-buy-oven'],['boxing2x','pizza-buy-boxing']];
        for (const [key,id] of map) {
            const b = pizzaShopEl.querySelector('#'+id);
            if (!b) continue;
            if (currentUser.pizzaUpgrades[key]) { b.disabled = true; b.textContent = 'OWNED ✓'; }
        }
    }

    function openPizzaUpgradeShop() {
        ensurePizzaProgress(); ensurePizzaShopUI(); refreshPizzaShopUI();
        if (pizzaShopEl) pizzaShopEl.style.display = 'flex';
    }
    function closePizzaUpgradeShop() { if (pizzaShopEl) pizzaShopEl.style.display = 'none'; }

    function buyPizzaUpgrade(kind) {
        ensurePizzaProgress();
        const costs = { prep2x:80, oven2x:120, boxing2x:100 };
        if (!costs[kind] || currentUser.pizzaUpgrades[kind]) return;
        if (currentUser.pizzaDohbux < costs[kind]) {
            addChatMessageUI('Pizza Shop', 'Not enough Pizza Dohbux yet. Complete more deliveries!');
            return;
        }
        currentUser.pizzaDohbux -= costs[kind];
        currentUser.pizzaUpgrades[kind] = true;
        saveToStorage(); updatePizzaHud(); refreshPizzaShopUI();
        addChatMessageUI('Pizza Shop', `Upgrade purchased: ${kind === 'prep2x' ? '2× Prep Speed' : kind === 'oven2x' ? '2× Oven Speed' : '2× Boxing Speed'}.`);
    }

    function pizzaStageDuration(kind) {
        ensurePizzaProgress();
        if (kind === 'prep') return currentUser.pizzaUpgrades.prep2x ? 1100 : 2200;
        if (kind === 'oven') return currentUser.pizzaUpgrades.oven2x ? 1800 : 3600;
        if (kind === 'boxing') return currentUser.pizzaUpgrades.boxing2x ? 900 : 1800;
        if (kind === 'dropoff') return 1400;
        return 1000;
    }

    function startPizzaAnimation(kind, onComplete) {
        if (pizzaJobAnimation) return false;
        pizzaJobAnimation = { kind, start: performance.now(), duration:pizzaStageDuration(kind), onComplete };
        if (kind === 'prep' && pizzaPrepPizzaVisual) pizzaPrepPizzaVisual.visible = true;
        if (kind === 'oven' && pizzaOvenPizzaVisual) pizzaOvenPizzaVisual.visible = true;
        if (kind === 'boxing' && pizzaBoxVisual) pizzaBoxVisual.visible = true;
        if (kind === 'prep' || kind === 'oven' || kind === 'boxing') playPizzaSound(kind);
        updatePizzaHud();
        return true;
    }

    function resetPizzaAvatarArms() {
        if (!currentGameAvatar) return;
        const la=currentGameAvatar.getObjectByName('leftArmGroup'), ra=currentGameAvatar.getObjectByName('rightArmGroup');
        if (la) la.rotation.x=0;
        if (ra) ra.rotation.x=0;
    }

    function updatePizzaJobAnimation(now) {
        if (!pizzaJobAnimation) return;
        const a=pizzaJobAnimation;
        const t=Math.max(0,Math.min(1,(now-a.start)/a.duration));
        const wave=Math.sin(t*Math.PI*8);
        if (currentGameAvatar) {
            const la=currentGameAvatar.getObjectByName('leftArmGroup'), ra=currentGameAvatar.getObjectByName('rightArmGroup');
            if (la) la.rotation.x=-0.5-wave*0.45;
            if (ra) ra.rotation.x=-0.5+wave*0.45;
        }
        if (a.kind==='prep' && pizzaPrepPizzaVisual) {
            pizzaPrepPizzaVisual.rotation.y += 0.18;
            const s=0.45+0.55*t; pizzaPrepPizzaVisual.scale.set(s,1,s);
            pizzaPrepPizzaVisual.position.y=2.9+Math.sin(t*Math.PI*6)*0.08;
        } else if (a.kind==='oven' && pizzaOvenPizzaVisual) {
            pizzaOvenPizzaVisual.rotation.y += 0.08;
            pizzaOvenPizzaVisual.position.z = -30.0 - 4.2*t;
            pizzaOvenGlowVisuals.forEach(g=>{ if(g.material) g.material.opacity=0.45+0.45*Math.sin(t*Math.PI); });
        } else if (a.kind==='boxing' && pizzaBoxLidVisual) {
            pizzaBoxLidVisual.rotation.x = -1.2*(1-t);
        } else if (a.kind==='dropoff' && pizzaDeliveryBoxVisual) {
            const end=pizzaHouseDropPoints[pizzaDeliveryTarget];
            if (end) {
                const sx=playerPos.x, sz=playerPos.z;
                pizzaDeliveryBoxVisual.position.set(sx+(end.x-sx)*t,1.5+1.2*Math.sin(t*Math.PI),sz+(end.z-sz)*t);
                pizzaDeliveryBoxVisual.rotation.y += 0.12;
            }
        }
        if (t>=1) {
            const done=a.onComplete;
            pizzaJobAnimation=null;
            resetPizzaAvatarArms();
            if (done) done();
        }
    }

    function createPizzaDisc(color=0xf6d37a) {
        const g=new THREE.Group();
        const crust=new THREE.Mesh(new THREE.CylinderGeometry(1.15,1.15,0.16,24),new THREE.MeshLambertMaterial({color:0xd89b45}));
        crust.rotation.x=Math.PI/2; g.add(crust);
        const cheese=new THREE.Mesh(new THREE.CylinderGeometry(1.0,1.0,0.08,24),new THREE.MeshLambertMaterial({color}));
        cheese.rotation.x=Math.PI/2; cheese.position.z=-0.08; g.add(cheese);
        for(let i=0;i<7;i++) { const p=new THREE.Mesh(new THREE.CylinderGeometry(0.16,0.16,0.04,10),new THREE.MeshLambertMaterial({color:0xb92727})); p.rotation.x=Math.PI/2; const ang=i*2.3; p.position.set(Math.cos(ang)*0.55,Math.sin(ang)*0.55,-0.14); g.add(p); }
        return g;
    }

    function createPizzaDeliveryCar() {
        const g=new THREE.Group();
        const red=new THREE.MeshLambertMaterial({color:0xc7352f}), dark=new THREE.MeshLambertMaterial({color:0x222222}), glass=new THREE.MeshPhongMaterial({color:0x8fd4e6,transparent:true,opacity:.65});
        const body=new THREE.Mesh(new THREE.BoxGeometry(5.8,1.4,8.5),red); body.position.y=1.25; g.add(body);
        const cabin=new THREE.Mesh(new THREE.BoxGeometry(5.0,1.8,4.5),red); cabin.position.set(0,2.45,-0.4); g.add(cabin);
        const windshield=new THREE.Mesh(new THREE.BoxGeometry(4.3,1.25,.16),glass); windshield.position.set(0,2.55,1.9); g.add(windshield);
        for(const sx of [-2.75,2.75]) for(const sz of [-2.7,2.7]) { const w=new THREE.Mesh(new THREE.CylinderGeometry(.75,.75,.55,16),dark); w.rotation.z=Math.PI/2; w.position.set(sx,.65,sz); g.add(w); }
        const sign=new THREE.Mesh(new THREE.BoxGeometry(3.8,.8,.3),new THREE.MeshLambertMaterial({color:0xf2cf43})); sign.position.set(0,3.65,-.3); g.add(sign);
        g.position.set(PIZZA_CAR_PARK.x,.35,PIZZA_CAR_PARK.z); g.rotation.y=pizzaCarYaw; gameScene.add(g); return g;
    }

    function createPizzaDeliveryBike() {
        const g = new THREE.Group();
        const red = new THREE.MeshLambertMaterial({color:0xc7352f});
        const dark = new THREE.MeshLambertMaterial({color:0x1d1d1d});
        const metal = new THREE.MeshLambertMaterial({color:0xb8b8b8});
        const yellow = new THREE.MeshLambertMaterial({color:0xf2cf43});
        const wheelGeo = new THREE.TorusGeometry(0.92,0.12,8,18);
        for (const z of [-1.55,1.55]) {
            const wheel = new THREE.Mesh(wheelGeo,dark); wheel.rotation.y=Math.PI/2; wheel.position.set(0,.95,z); g.add(wheel);
        }
        const frameA=new THREE.Mesh(new THREE.BoxGeometry(.18,.18,2.8),red); frameA.position.set(0,1.15,0); frameA.rotation.x=.25; g.add(frameA);
        const frameB=new THREE.Mesh(new THREE.BoxGeometry(.18,1.5,.18),red); frameB.position.set(0,1.55,-.55); frameB.rotation.x=-.55; g.add(frameB);
        const handle=new THREE.Mesh(new THREE.BoxGeometry(1.5,.12,.12),metal); handle.position.set(0,2.25,1.25); g.add(handle);
        const seat=new THREE.Mesh(new THREE.BoxGeometry(.85,.16,.55),dark); seat.position.set(0,2.0,-.55); g.add(seat);
        const basket=new THREE.Mesh(new THREE.BoxGeometry(1.7,1.05,1.55),yellow); basket.position.set(0,1.85,-1.65); g.add(basket);
        const box=new THREE.Mesh(new THREE.BoxGeometry(1.4,.28,1.25),new THREE.MeshLambertMaterial({color:0xf3e3be})); box.position.set(0,2.48,-1.65); g.add(box);
        g.position.set(PIZZA_BIKE_PARK.x,.15,PIZZA_BIKE_PARK.z); g.rotation.y=pizzaBikeYaw; gameScene.add(g); return g;
    }

    function enterPizzaCar() {
        if (!pizzaDeliveryCar) return;
        if (currentGameAvatar) setPizzaBikeRiderPose(currentGameAvatar,false);
        pizzaInCar=true; pizzaInBike=false;
        pizzaDeliveryDriveStarted = pizzaJobStage === 'delivery' ? true : pizzaDeliveryDriveStarted;
        playerPos.x=pizzaDeliveryCar.position.x; playerPos.z=pizzaDeliveryCar.position.z; playerPos.y=.35;
        if (currentGameAvatar) currentGameAvatar.visible=false;
        playPizzaSound('vehicle_enter');
        addChatMessageUI('Delivery', pizzaJobStage==='delivery' ? `Car ready. Drive to ${pizzaDeliveryTarget}, or exit whenever you want.` : 'Delivery car entered.');
        updatePizzaHud();
    }

    function exitPizzaCar() {
        if (!pizzaDeliveryCar) return;
        pizzaInCar=false;
        if (currentGameAvatar) currentGameAvatar.visible=true;
        playerPos.x=pizzaDeliveryCar.position.x+4.2; playerPos.z=pizzaDeliveryCar.position.z;
        playerPos.y=Math.max(playerPos.y,.5);
        addChatMessageUI('Delivery','Exited delivery car.');
        updatePizzaHud();
    }

    function setPizzaBikeRiderPose(character, enabled) {
        if (!character) return;
        const la=character.getObjectByName('leftArmGroup'), ra=character.getObjectByName('rightArmGroup');
        const ll=character.getObjectByName('leftLegGroup'), rl=character.getObjectByName('rightLegGroup');
        if (enabled) {
            if (la) { la.rotation.x=-1.02; la.rotation.z=-0.12; }
            if (ra) { ra.rotation.x=-1.02; ra.rotation.z=0.12; }
            if (ll) ll.rotation.x=-1.18;
            if (rl) rl.rotation.x=-1.18;
        } else {
            if (la) { la.rotation.x=0; la.rotation.z=0; }
            if (ra) { ra.rotation.x=0; ra.rotation.z=0; }
            if (ll) ll.rotation.x=0;
            if (rl) rl.rotation.x=0;
        }
    }

    function positionPizzaBikeRider() {
        if (!pizzaInBike || !pizzaDeliveryBike || !currentGameAvatar) return;
        const seatOffset = -0.55;
        currentGameAvatar.visible = true;
        currentGameAvatar.position.set(
            pizzaDeliveryBike.position.x + Math.sin(pizzaBikeYaw) * seatOffset,
            0.72,
            pizzaDeliveryBike.position.z + Math.cos(pizzaBikeYaw) * seatOffset
        );
        currentGameAvatar.rotation.y = pizzaBikeYaw;
        setPizzaBikeRiderPose(currentGameAvatar, true);
    }

    function enterPizzaBike() {
        if (!pizzaDeliveryBike) return;
        pizzaInBike=true; pizzaInCar=false;
        pizzaDeliveryDriveStarted = pizzaJobStage === 'delivery' ? true : pizzaDeliveryDriveStarted;
        playerPos.x=pizzaDeliveryBike.position.x; playerPos.z=pizzaDeliveryBike.position.z; playerPos.y=.25;
        if (currentGameAvatar) currentGameAvatar.visible=true;
        positionPizzaBikeRider();
        playPizzaSound('vehicle_enter');
        addChatMessageUI('Delivery', pizzaJobStage==='delivery' ? `Bike ready. Ride to ${pizzaDeliveryTarget}, or exit whenever you want.` : 'Delivery bike entered.');
        updatePizzaHud();
    }

    function exitPizzaBike() {
        if (!pizzaDeliveryBike) return;
        pizzaInBike=false;
        if (currentGameAvatar) { currentGameAvatar.visible=true; setPizzaBikeRiderPose(currentGameAvatar,false); }
        playerPos.x=pizzaDeliveryBike.position.x+2.0; playerPos.z=pizzaDeliveryBike.position.z;
        playerPos.y=Math.max(playerPos.y,.5);
        addChatMessageUI('Delivery','Got off the delivery bike.');
        updatePizzaHud();
    }

    function updatePizzaHouseOutline() {
        Object.entries(pizzaHouseOutlines).forEach(([name,obj])=>{ if(obj) obj.visible = pizzaJobStage==='delivery' && name===pizzaDeliveryTarget; });
        updatePizzaHud();
    }

    function cleanupPizzaPlaceState() {
        closePizzaUpgradeShop();
        stopPizzaGameMusic();
        if (pizzaHudEl) pizzaHudEl.style.display='none';
        if (isPizzaPlaceActive()) sendNetworkMessage('PIZZA_ORDER_STATUS', {active:false});
        pizzaInCar=false; pizzaInBike=false; pizzaDeliveryCar=null; pizzaDeliveryBike=null; pizzaJobAnimation=null; pizzaDeliveryDriveStarted=false;
        pizzaHouseOutlines={}; pizzaHouseDropPoints={}; pizzaPrepPizzaVisual=null; pizzaOvenPizzaVisual=null; pizzaBoxVisual=null; pizzaBoxLidVisual=null; pizzaDeliveryBoxVisual=null; pizzaOvenGlowVisuals=[];
        pizzaRemoteOrders=Object.create(null); pizzaLocalOrderId=null; pizzaActiveOrderCustomerId=null;
        if (currentGameAvatar) { currentGameAvatar.visible=true; setPizzaBikeRiderPose(currentGameAvatar,false); }
    }


    function createPizzaCustomerMesh(seed) {
        const g = new THREE.Group();
        const skin = new THREE.MeshLambertMaterial({ color: 0xf0c39b });
        const shirts = [0x3d79c8,0xd74646,0x55a85e,0x8a5bc2,0xe39b38,0x4b9fa3];
        const pants = [0x313a4b,0x3c3c3c,0x5b493a,0x263b65];
        const shirt = new THREE.MeshLambertMaterial({ color: shirts[seed % shirts.length] });
        const pant = new THREE.MeshLambertMaterial({ color: pants[seed % pants.length] });
        const head = new THREE.Mesh(new THREE.BoxGeometry(1.05,1.05,1.05), skin); head.position.y=3.25; g.add(head);
        const torso = new THREE.Mesh(new THREE.BoxGeometry(1.65,1.85,0.9), shirt); torso.position.y=2.0; g.add(torso);
        const armL = new THREE.Mesh(new THREE.BoxGeometry(0.55,1.75,0.6), skin); armL.position.set(-1.1,2.0,0); g.add(armL);
        const armR = armL.clone(); armR.position.x=1.1; g.add(armR);
        const legL = new THREE.Mesh(new THREE.BoxGeometry(0.7,1.7,0.75), pant); legL.position.set(-0.45,0.55,0); g.add(legL);
        const legR = legL.clone(); legR.position.x=0.45; g.add(legR);
        return g;
    }


    function createPizzaCustomerSpeechBubble(order) {
        const canvas=document.createElement('canvas'); canvas.width=640; canvas.height=180;
        const ctx=canvas.getContext('2d');
        ctx.fillStyle='rgba(255,255,255,.96)'; ctx.strokeStyle='#222'; ctx.lineWidth=8;
        ctx.beginPath(); ctx.roundRect(12,12,616,138,24); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(295,150); ctx.lineTo(325,176); ctx.lineTo(345,150); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle='#111'; ctx.font='bold 36px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(`I'd like a ${order} pizza!`,320,81);
        const tex=new THREE.CanvasTexture(canvas); tex.needsUpdate=true;
        const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false,depthWrite:false}));
        sprite.scale.set(7.6,2.15,1); sprite.position.set(0,5.25,0); sprite.visible=false;
        return sprite;
    }

    function updatePizzaCustomerSpeech(c) {
        if (!c || !c.bubble) return;
        const shouldSpeak = c.phase === 'waiting' && c.queueIndex === 0;
        c.bubble.visible = shouldSpeak;
        if (shouldSpeak && !c.spoke) {
            c.spoke = true;
            playPizzaSound('customer');
            addChatMessageUI('Customer', `I'd like a ${c.order} pizza!`);
        }
        if (c.phase === 'leaving' || c.phase === 'gone') c.bubble.visible=false;
    }

    function pizzaQueuePositions() {
        return [
            {x:-10,z:-6}, {x:-10,z:-2.5}, {x:-10,z:1}, {x:-6,z:2.5}
        ];
    }

    function refreshPizzaCustomerQueueTargets() {
        const waiting = pizzaCustomers.filter(c => c.phase === 'queue' || c.phase === 'waiting');
        const spots = pizzaQueuePositions();
        waiting.forEach((c,i) => {
            c.queueIndex = Math.min(i, spots.length - 1);
            c.targetX = spots[c.queueIndex].x;
            c.targetZ = spots[c.queueIndex].z;
            c.phase = 'queue';
        });
    }

    function spawnPizzaCustomer(force=false) {
        if (!isPizzaPlaceActive() || !gameScene) return;
        const activeCount = pizzaCustomers.filter(c => c.phase !== 'gone').length;
        if (!force && activeCount >= PIZZA_CUSTOMER_MAX) return;
        pizzaCustomerCounter++;
        const mesh = createPizzaCustomerMesh(pizzaCustomerCounter);
        mesh.position.set(3 + (pizzaCustomerCounter % 3) * 1.7, 0.9, 18 + (pizzaCustomerCounter % 2) * 2.0);
        gameScene.add(mesh);
        const customer = {
            id:`pizza_customer_${pizzaCustomerCounter}`,
            mesh,
            phase:'enter',
            pathStep:0,
            targetX:0,
            targetZ:8,
            queueIndex:-1,
            order:['Cheese','Pepperoni','Sausage'][pizzaCustomerCounter % 3],
            bubble:null,
            spoke:false
        };
        customer.bubble=createPizzaCustomerSpeechBubble(customer.order);
        mesh.add(customer.bubble);
        pizzaCustomers.push(customer);
    }

    function movePizzaCustomerToward(c, tx, tz, dt, speed=4.3) {
        if (!c.mesh) return true;
        const dx=tx-c.mesh.position.x, dz=tz-c.mesh.position.z;
        const d=Math.hypot(dx,dz);
        if (d < 0.18) { c.mesh.position.x=tx; c.mesh.position.z=tz; return true; }
        const step=Math.min(d,speed*dt);
        c.mesh.position.x += dx/d*step;
        c.mesh.position.z += dz/d*step;
        c.mesh.rotation.y = Math.atan2(dx,dz);
        c.mesh.position.y = 0.9 + Math.abs(Math.sin(performance.now()*0.012 + c.id.length))*0.05;
        return false;
    }

    function updatePizzaCustomers(nowPerf, dt) {
        if (!isPizzaPlaceActive() || !gameScene) return;
        if (!pizzaLastCustomerSpawnAt) pizzaLastCustomerSpawnAt = nowPerf - PIZZA_CUSTOMER_SPAWN_MS;
        if (nowPerf - pizzaLastCustomerSpawnAt >= PIZZA_CUSTOMER_SPAWN_MS) {
            pizzaLastCustomerSpawnAt = nowPerf;
            spawnPizzaCustomer(false);
        }
        const queueSpots = pizzaQueuePositions();
        for (let i=pizzaCustomers.length-1;i>=0;i--) {
            const c=pizzaCustomers[i];
            if (!c.mesh) { pizzaCustomers.splice(i,1); continue; }
            if (c.phase === 'enter') {
                if (c.pathStep === 0) {
                    if (movePizzaCustomerToward(c,0,7.5,dt)) c.pathStep=1;
                } else if (c.pathStep === 1) {
                    if (movePizzaCustomerToward(c,-7,2.5,dt)) {
                        c.phase='queue';
                        refreshPizzaCustomerQueueTargets();
                    }
                }
            } else if (c.phase === 'queue') {
                const spot=queueSpots[Math.max(0,Math.min(c.queueIndex,queueSpots.length-1))];
                if (movePizzaCustomerToward(c,spot.x,spot.z,dt,3.6)) c.phase='waiting';
            } else if (c.phase === 'waiting') {
                c.mesh.rotation.y = Math.PI;
            } else if (c.phase === 'leaving') {
                if (c.bubble) c.bubble.visible=false;
                if (c.pathStep === 0) {
                    if (movePizzaCustomerToward(c,0,7.5,dt)) c.pathStep=1;
                } else if (c.pathStep === 1) {
                    if (movePizzaCustomerToward(c,0,23,dt,4.8)) {
                        if (c.mesh.parent) c.mesh.parent.remove(c.mesh);
                        c.phase='gone';
                        pizzaCustomers.splice(i,1);
                    }
                }
            }
            updatePizzaCustomerSpeech(c);
        }
    }

    function firstWaitingPizzaCustomer() {
        return pizzaCustomers.find(c => c.phase === 'waiting') || null;
    }

    function solidPlayerBoxAt(x, z) {
        return new THREE.Box3().setFromCenterAndSize(
            new THREE.Vector3(x, playerPos.y + 1.4, z),
            new THREE.Vector3(0.82, 2.65, 0.82)
        );
    }

    function solidPositionBlocked(x, z) {
        const box = solidPlayerBoxAt(x, z);
        for (const c of gameColliders) {
            // Small risers can be stepped onto; floors below the feet do not block sideways movement.
            if (c.max.y <= playerPos.y + 0.72) continue;
            if (c.min.y >= playerPos.y + 2.72) continue;
            if (box.intersectsBox(c)) return true;
        }
        return false;
    }

    function resolveSolidWorldHorizontalCollision(previousX, previousZ) {
        if (!(isDohbloxHQActive() || isCrossroadsMapActive() || isPizzaPlaceActive())) return;
        const attemptedX = playerPos.x;
        const attemptedZ = playerPos.z;
        if (solidPositionBlocked(attemptedX, previousZ)) playerPos.x = previousX;
        if (solidPositionBlocked(playerPos.x, attemptedZ)) playerPos.z = previousZ;
    }

    function demolishNearestHQPiece() {
        if (!isDohbloxHQActive() || !hqDestructibles.length) return;
        const now = Date.now();
        if (now - hqBreakLastAt < 450) return;
        hqBreakLastAt = now;

        const p = new THREE.Vector3(playerPos.x, playerPos.y + 1.3, playerPos.z);
        const nearest = new THREE.Vector3();
        let best = null;
        let bestDist = 3.3;
        for (const piece of hqDestructibles) {
            if (!piece.collider) continue;
            piece.collider.clampPoint(p, nearest);
            const d = nearest.distanceTo(p);
            if (d < bestDist) {
                bestDist = d;
                best = piece;
            }
        }
        if (!best) {
            addChatMessageUI('HQ', 'Move closer to a breakable wall, window, or interior panel.');
            return;
        }
        destroyDohbloxHQPiece(best);
        addChatMessageUI('HQ', 'Section removed. The HQ rebuilds automatically every 10 minutes.');
    }

    function distance2D(a, b) {
        const dx = a.x - b.x;
        const dz = a.z - b.z;
        return Math.sqrt(dx * dx + dz * dz);
    }

    function nearestPizzaInteractable(maxDistance = 4.0) {
        const here = { x: playerPos.x, z: playerPos.z };
        let best = null;
        let bestD = maxDistance;
        for (const it of pizzaInteractables) {
            const d = distance2D(here, it);
            if (d < bestD) { bestD = d; best = it; }
        }
        return best;
    }


    function randomPizzaHouse() {
        const houses = ['A1','A2','B1','B2','C1','C2'];
        return houses[Math.floor(Math.random() * houses.length)];
    }

    function resetPizzaOrder() {
        pizzaJobStage = 'cashier';
        pizzaDeliveryTarget = randomPizzaHouse();
        pizzaDeliveryDriveStarted = false;
        pizzaActiveOrderCustomerId = null;
        pizzaLocalOrderId = null;
        updatePizzaHouseOutline();
        broadcastPizzaOrderStatus();
    }

    function rewardPizzaWork(amount, reason) {
        ensurePizzaProgress();
        const earned = amount * pizzaPayMultiplier();
        currentUser.pizzaDohbux += earned;
        saveToStorage();
        updatePizzaHud();
        addChatMessageUI('Pizza Job', `${reason} +${earned} Pizza Dohbux${isPizzaWeekend() ? ' (2× weekend pay!)' : ''}.`);
    }

    function completePizzaDelivery(method='walk') {
        if (pizzaJobStage !== 'delivery' || pizzaJobAnimation || !pizzaDeliveryBoxVisual) return;
        pizzaDeliveryBoxVisual.visible=true;
        playPizzaSound('delivery');
        startPizzaAnimation('dropoff',()=>{
            pizzaDeliveryBoxVisual.visible=false;
            pizzaCompletedOrders++;
            rewardPizzaWork(15,`Delivered order ${pizzaCompletedOrders}`);
            sendNetworkMessage('PIZZA_ORDER_STATUS', {
                active:true, orderId:pizzaLocalOrderId, orderName:pizzaCurrentOrderName,
                stage:'delivered', target:pizzaDeliveryTarget
            });
            resetPizzaOrder();
            const pretty = method === 'bike' ? 'bike' : method === 'car' ? 'car' : 'on foot';
            addChatMessageUI('Pizza Job',`Delivery complete ${pretty}! Serve the next customer.`);
        });
    }

    function interactPizzaPlace() {
        if (!isPizzaPlaceActive()) return;
        if (pizzaJobAnimation) {
            addChatMessageUI('Pizza Job','Finish the current work animation first.');
            return;
        }

        const here={x:playerPos.x,z:playerPos.z};
        const targetDrop=pizzaHouseDropPoints[pizzaDeliveryTarget];

        // Vehicles are optional. Interact near the correct house to deliver, or interact anywhere else to exit.
        if (pizzaInCar || pizzaInBike) {
            if (pizzaJobStage==='delivery' && targetDrop && distance2D(here,targetDrop)<6.5) {
                completePizzaDelivery(pizzaInBike ? 'bike' : 'car');
                return;
            }
            if (pizzaInBike) exitPizzaBike(); else exitPizzaCar();
            return;
        }

        if (pizzaDeliveryCar && distance2D(here,{x:pizzaDeliveryCar.position.x,z:pizzaDeliveryCar.position.z})<5.2) {
            enterPizzaCar();
            return;
        }
        if (pizzaDeliveryBike && distance2D(here,{x:pizzaDeliveryBike.position.x,z:pizzaDeliveryBike.position.z})<4.2) {
            enterPizzaBike();
            return;
        }

        const it = nearestPizzaInteractable();
        if (!it) {
            addChatMessageUI('Pizza Job', 'Move next to a labeled station, vehicle, shop, or house and interact again.');
            return;
        }

        if (it.id === 'cashier') {
            if (pizzaJobStage !== 'cashier') return addChatMessageUI('Pizza Job','Finish your current order first.');
            const customer = firstWaitingPizzaCustomer();
            if (!customer) return addChatMessageUI('Pizza Job','No customer is at the counter yet.');
            pizzaActiveOrderCustomerId = customer.id;
            pizzaCurrentOrderName = customer.order;
            pizzaLocalOrderId = `${localSessionId}_${Date.now()}_${pizzaCustomerCounter}`;
            if (customer.bubble) customer.bubble.visible=false;
            customer.phase = 'leaving'; customer.pathStep = 0;
            pizzaDeliveryTarget = randomPizzaHouse();
            pizzaJobStage = 'prep';
            refreshPizzaCustomerQueueTargets(); updatePizzaHouseOutline();
            broadcastPizzaOrderStatus();
            playPizzaSound('order');
            addChatMessageUI('Pizza Job', `${pizzaCurrentOrderName} order accepted. PREP the pizza first.`);
        } else if (it.id === 'prep') {
            if (pizzaJobStage !== 'prep') return addChatMessageUI('Pizza Job','Take a customer order first.');
            addChatMessageUI('Pizza Job',`Preparing ${pizzaCurrentOrderName} pizza${currentUser.pizzaUpgrades?.prep2x ? ' at 2× speed' : ''}...`);
            startPizzaAnimation('prep',()=>{ pizzaJobStage='oven'; broadcastPizzaOrderStatus(); updatePizzaHud(); addChatMessageUI('Pizza Job','Pizza prepared. Put it in an oven.'); });
        } else if (it.id === 'oven') {
            if (pizzaJobStage !== 'oven') return addChatMessageUI('Pizza Job','Prepare the pizza before using the oven.');
            addChatMessageUI('Pizza Job',`Baking pizza${currentUser.pizzaUpgrades?.oven2x ? ' at 2× speed' : ''}...`);
            startPizzaAnimation('oven',()=>{ if(pizzaOvenPizzaVisual) pizzaOvenPizzaVisual.visible=false; pizzaJobStage='boxer'; broadcastPizzaOrderStatus(); updatePizzaHud(); addChatMessageUI('Pizza Job','Pizza cooked. Take it to the boxing table.'); });
        } else if (it.id === 'boxer') {
            if (pizzaJobStage !== 'boxer') return addChatMessageUI('Pizza Job','Only cooked pizzas can be boxed.');
            addChatMessageUI('Pizza Job',`Boxing pizza${currentUser.pizzaUpgrades?.boxing2x ? ' at 2× speed' : ''}...`);
            startPizzaAnimation('boxing',()=>{ pizzaJobStage='delivery'; broadcastPizzaOrderStatus(); updatePizzaHouseOutline(); addChatMessageUI('Pizza Job',`Pizza boxed. Deliver to white-outlined house ${pizzaDeliveryTarget} by walking, car, or bike.`); });
        } else if (it.id.startsWith('house_')) {
            const house=it.id.replace('house_','');
            if (pizzaJobStage !== 'delivery') return addChatMessageUI('Pizza Job','You do not have a boxed delivery yet.');
            if (house !== pizzaDeliveryTarget) return addChatMessageUI('Pizza Job',`Wrong house. Look for the white outline around ${pizzaDeliveryTarget}.`);
            completePizzaDelivery('walk');
        } else if (it.id === 'upgrade_shop') {
            openPizzaUpgradeShop();
        } else if (it.id === 'supplier_pickup') {
            if (pizzaSupplierLoaded) return addChatMessageUI('Supplier','You already have supplies loaded.');
            pizzaSupplierLoaded = true; playPizzaSound('boxing'); addChatMessageUI('Supplier','Supplies loaded. Bring them to the pizzeria loading dock.');
        } else if (it.id === 'supplier_drop') {
            if (!pizzaSupplierLoaded) return addChatMessageUI('Supplier','Pick up supplies from the warehouse first.');
            pizzaSupplierLoaded = false; playPizzaSound('delivery'); rewardPizzaWork(8,'Supplies delivered');
        } else if (it.id === 'manager') {
            addChatMessageUI('Manager','Keep the line moving and make every order correctly!');
        }
    }

    function performContextInteraction() {
        if (isNaturalDisasterActive()) return interactNaturalDisasterWorld();
        if (isPizzaPlaceActive()) return interactPizzaPlace();
        if (isDohbloxHQActive()) return demolishNearestHQPiece();
        if (activeEquippedWeapon && activeEquippedWeapon.type === 'boombox') return toggleBoomboxMusic();
    }


    function performAttack() {
        if (activeEquippedWeapon && activeEquippedWeapon.type === 'boombox') {
            toggleBoomboxMusic();
            return;
        }

        if (isNaturalDisasterActive()) {
            if (interactNaturalDisasterWorld()) return;
            if (activeEquippedWeapon && activeEquippedWeapon.type && activeEquippedWeapon.type.startsWith('nds_')) useNDSItem(activeEquippedWeapon.type);
            return;
        }

        if (isPizzaPlaceActive()) {
            performContextInteraction();
            return;
        }

        if (isCrossroadsActive() && activeEquippedWeapon) {
            const weaponType = activeEquippedWeapon.type;
            const remaining = getCrossroadsCooldownRemaining(weaponType);
            if (remaining > 0) return;
            crossroadsLastUseTimes[weaponType] = Date.now();
            refreshCrossroadsCooldownUI();

            if (weaponType === 'sword' || weaponType === 'linked_sword') {
                if (isAttacking) return;
                isAttacking = true;
                attackSwingTimer = 0;
                playSwingSound();
                const dir = getCrossroadsAimDirection(true);
                sendNetworkMessage('CROSSROADS_SWORD_SWING', {
                    position: { x: playerPos.x, y: playerPos.y + 1.4, z: playerPos.z },
                    direction: { x: dir.x, y: dir.y, z: dir.z }
                });
            } else if (weaponType === 'rocket_launcher') {
                fireCrossroadsProjectile('rocket');
            } else if (weaponType === 'slingshot') {
                fireCrossroadsProjectile('slingshot');
            } else if (weaponType === 'timebomb') {
                placeCrossroadsBomb();
            } else if (weaponType === 'trowel') {
                placeCrossroadsWall();
            }
            return;
        }

        if (isAttacking) return;
        isAttacking = true;
        attackSwingTimer = 0;
        playSwingSound();
    }

    function handleChatKey(e) {
        if (e.key === 'Enter') {
            sendChatMessage();
        }
    }

    function sendChatMessage() {
        const input = document.getElementById('chat-input-field');
        const msg = input.value.trim();
        if (!msg) return;

        const lower = msg.toLowerCase();
        if (lower === '/e dance') {
            triggerLocalDance();
            input.value = '';
            return;
        }

        if (lower === '/announce' || lower.startsWith('/announce ')) {
            const announcement = msg.slice('/announce'.length).trim();
            const authorized = !isGuestUser(currentUser.username) && (currentUser.isMod || currentUser.isOwner);

            if (!authorized) {
                addChatMessageUI('System', 'Only moderators and the owner can use /announce.');
            } else if (!announcement) {
                addChatMessageUI('System', 'Usage: /announce your message');
            } else {
                addAnnouncementUI(currentUser.username, announcement);
                sendNetworkMessage('ANNOUNCEMENT', { text: announcement, authorized: true });
            }
            input.value = '';
            return;
        }

        addChatMessageUI(currentUser.username, msg);
        showOverheadChatBubble(localSessionId, currentUser.username, msg);
        sendNetworkMessage('CHAT', { text: msg });
        input.value = '';
    }

    function addAnnouncementUI(user, msg) {
        const chatBox = document.getElementById('chat-messages');
        if (!chatBox) return;
        const msgEl = document.createElement('div');
        msgEl.className = 'chat-msg';
        msgEl.style.background = 'rgba(180, 20, 20, 0.75)';
        msgEl.style.border = '1px solid rgba(255,255,255,0.45)';
        msgEl.style.padding = '4px 5px';
        msgEl.style.borderRadius = '3px';
        msgEl.style.fontWeight = 'bold';
        msgEl.textContent = `ANNOUNCEMENT — ${user}: ${msg}`;
        chatBox.appendChild(msgEl);
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    function triggerLocalDance() {
        localDanceUntil = Date.now() + 8000;
        sendNetworkMessage('DANCE', { durationMs: 8000 });
    }

    function resetCharacterDancePose(charGroup) {
        if (!charGroup) return;
        const leftArm = charGroup.getObjectByName('leftArmGroup');
        const rightArm = charGroup.getObjectByName('rightArmGroup');
        const leftLeg = charGroup.getObjectByName('leftLegGroup');
        const rightLeg = charGroup.getObjectByName('rightLegGroup');
        const torso = charGroup.getObjectByName('torso');
        const head = charGroup.getObjectByName('head');
        if (leftArm) { leftArm.rotation.x = 0; leftArm.rotation.y = 0; leftArm.rotation.z = 0; }
        if (rightArm) { rightArm.rotation.x = 0; rightArm.rotation.y = 0; rightArm.rotation.z = 0; }
        if (leftLeg) { leftLeg.rotation.x = 0; leftLeg.rotation.y = 0; leftLeg.rotation.z = 0; }
        if (rightLeg) { rightLeg.rotation.x = 0; rightLeg.rotation.y = 0; rightLeg.rotation.z = 0; }
        if (torso) { torso.rotation.x = 0; torso.rotation.y = 0; torso.rotation.z = 0; }
        if (head) { head.rotation.x = 0; head.rotation.y = 0; head.rotation.z = 0; }
    }

    function applyDancePose(charGroup, timeSeconds) {
        if (!charGroup) return;
        const leftArm = charGroup.getObjectByName('leftArmGroup');
        const rightArm = charGroup.getObjectByName('rightArmGroup');
        const leftLeg = charGroup.getObjectByName('leftLegGroup');
        const rightLeg = charGroup.getObjectByName('rightLegGroup');
        const torso = charGroup.getObjectByName('torso');
        const head = charGroup.getObjectByName('head');
        const beat = Math.sin(timeSeconds * 7.0);
        const beat2 = Math.sin(timeSeconds * 3.5 + Math.PI / 2);
        if (leftArm) { leftArm.rotation.x = -0.7 + beat * 0.7; leftArm.rotation.z = -0.55 - beat2 * 0.35; }
        if (rightArm) { rightArm.rotation.x = -0.7 - beat * 0.7; rightArm.rotation.z = 0.55 + beat2 * 0.35; }
        if (leftLeg) leftLeg.rotation.x = beat * 0.38;
        if (rightLeg) rightLeg.rotation.x = -beat * 0.38;
        if (torso) torso.rotation.z = beat2 * 0.12;
        if (head) head.rotation.y = beat * 0.22;
    }

    function updateDanceAnimations(isMoving) {
        const now = Date.now();
        if (isMoving && localDanceUntil > now) localDanceUntil = 0;

        const localDancing = localDanceUntil > now && !isAttacking;
        if (localDancing) {
            applyDancePose(currentGameAvatar, performance.now() / 1000);
        } else if (!isMoving && !isAttacking && currentGameAvatar) {
            resetCharacterDancePose(currentGameAvatar);
        }

        for (const id in remotePlayers) {
            const p = remotePlayers[id];
            if (!p || !p.mesh) continue;
            if ((p.danceUntil || 0) > now) applyDancePose(p.mesh, performance.now() / 1000 + id.length * 0.17);
            else if (p.wasDancing) resetCharacterDancePose(p.mesh);
            p.wasDancing = (p.danceUntil || 0) > now;
        }
    }

    function addChatMessageUI(user, msg) {
        const chatBox = document.getElementById('chat-messages');
        if (!chatBox) return;

        const msgEl = document.createElement('div');
        msgEl.className = 'chat-msg';
        msgEl.innerHTML = `<span class="chat-user">${user}:</span> ${msg}`;
        chatBox.appendChild(msgEl);
        chatBox.scrollTop = chatBox.scrollHeight;
    }




    /* ============================================================
       DOHBLOX STUDIO + PUBLISHED PLACE RUNTIME
       ============================================================ */
    const STUDIO_PUBLISHED_KEY = 'dohblox_studio_published_v3';
    const STUDIO_DRAFT_KEY = 'dohblox_studio_draft_v3';

    /* FIREBASE PUBLIC COMMUNITY GAMES
       Replace these TWO values before releasing so every visitor automatically uses
       the same public community catalog. The Firebase Web API key is intended to be
       public; security is enforced by Firestore Rules. Never embed a service-account
       private key in this file. */
    const FIREBASE_STUDIO_DEFAULT = (window.DOHBLOX_FIREBASE_CONFIG && typeof window.DOHBLOX_FIREBASE_CONFIG === 'object')
        ? window.DOHBLOX_FIREBASE_CONFIG
        : { projectId: 'dohblox-6254c', apiKey: 'AIzaSyDKwXHLFhrocDUu3U3UXvwGcawTKK_v8Lg', authDomain: 'dohblox-6254c.firebaseapp.com' };
    const FIREBASE_STUDIO_SETTINGS_KEY = 'dohblox_firebase_public_studio_v1';
    let firebaseStudioApp=null, firebaseStudioAuth=null, firebaseStudioDb=null, firebaseStudioUser=null;
    let publicStudioGamesCache=[];
    let publicStudioRefreshInFlight=null;
    let publicStudioRefreshTimer=null;

    let studioPublishChannel = null;
    let studioScene = null, studioCamera = null, studioRenderer = null, studioAnimId = null;
    let studioWorld = null, studioSelectedId = null, studioSelectionHelper = null;
    let studioTool = 'select', studioHistory = [], studioRedoStack = [], studioPartCounter = 0;
    let studioCameraYaw = 0.72, studioCameraPitch = 0.48, studioCameraDistance = 36;
    let studioCameraTarget = new THREE.Vector3(0, 3, 0);
    let studioPointerMode = null, studioPointerStart = null, studioStartPartState = null;
    let studioCurrentPublishedId = null, studioReturnAfterTest = false;
    let activeGameRecord = null;
    let studioRuntimeParts = [], studioRuntimeGravity = 1, studioPublishedSpawn = null;
    let studioRuntimeTouchTimes = new Map();

    function studioDefaultWorld() {
        return {
            version: 3,
            title: 'My Dohblox Place',
            description: 'Made in Dohblox Studio.',
            skyColor: '#7db7eb',
            gravity: 1,
            starterGear: 'none',
            parts: [
                {id:'baseplate',name:'Baseplate',shape:'block',pos:[0,-0.5,0],size:[48,1,48],rot:[0,0,0],color:'#559b3c',material:'Plastic',transparency:0,anchored:true,canCollide:true,behavior:'none',behaviorValue:'',script:''},
                {id:'spawn',name:'SpawnLocation',shape:'block',pos:[0,0.25,0],size:[6,0.5,6],rot:[0,0,0],color:'#5aa8ff',material:'Neon',transparency:0.15,anchored:true,canCollide:true,isSpawn:true,behavior:'none',behaviorValue:'',script:''}
            ]
        };
    }

    function studioClone(v) { return JSON.parse(JSON.stringify(v)); }
    function studioSafeNum(v, fallback=0) { const n=Number(v); return Number.isFinite(n)?n:fallback; }
    function studioNewId(prefix='Part') { studioPartCounter++; return `${prefix}_${Date.now().toString(36)}_${studioPartCounter}`; }
    function studioEsc(s) { return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

    function getFirebaseStudioConfig() {
        let override=null;
        try { override=JSON.parse(localStorage.getItem(FIREBASE_STUDIO_SETTINGS_KEY)||'null'); } catch(_) {}
        const base=(override&&typeof override==='object')?override:FIREBASE_STUDIO_DEFAULT;
        const projectId=String(base.projectId||'').trim();
        const apiKey=String(base.apiKey||'').trim();
        const authDomain=String(base.authDomain||((projectId && !projectId.includes('YOUR_')) ? projectId+'.firebaseapp.com' : '')).trim();
        return {apiKey,projectId,authDomain};
    }

    function isFirebaseStudioConfigured() {
        const c=getFirebaseStudioConfig();
        return typeof firebase!=='undefined' && c.apiKey.length>20 && !c.apiKey.includes('YOUR_FIREBASE') && c.projectId.length>3 && !c.projectId.includes('YOUR_FIREBASE');
    }

    function studioConfigurePublicBackend() {
        const current=getFirebaseStudioConfig();
        const projectId=prompt('Firebase Project ID (example: my-dohblox-project):', current.projectId.includes('YOUR_FIREBASE')?'':current.projectId);
        if(projectId===null)return;
        const apiKey=prompt('Firebase Web API key (safe/public key — NOT a service-account private key):', current.apiKey.includes('YOUR_FIREBASE')?'':current.apiKey);
        if(apiKey===null)return;
        const cleanProject=String(projectId).trim();
        const cleanKey=String(apiKey).trim();
        if(cleanProject.length<4 || cleanKey.length<20){alert('That Firebase configuration does not look valid.');return;}
        const cfg={projectId:cleanProject,apiKey:cleanKey,authDomain:cleanProject+'.firebaseapp.com'};
        localStorage.setItem(FIREBASE_STUDIO_SETTINGS_KEY,JSON.stringify(cfg));
        firebaseStudioApp=null;firebaseStudioAuth=null;firebaseStudioDb=null;firebaseStudioUser=null;
        studioOutput('Firebase public Studio configured. Testing connection…','ok');
        refreshPublicStudioGames(true,true);
    }

    function firebaseStudioAppName(c) {
        return 'dohblox-public-'+String(c.projectId||'project').replace(/[^a-z0-9_-]/gi,'_');
    }

    async function initFirebasePublicStudio(showResult=false) {
        if(!isFirebaseStudioConfigured()) {
            if(showResult) studioOutput('Firebase sharing is not configured. Use Firebase Setup or fill FIREBASE_STUDIO_DEFAULT in the HTML.','warn');
            return false;
        }
        try {
            const c=getFirebaseStudioConfig();
            const appName=firebaseStudioAppName(c);
            let app=null;
            try { app=firebase.app(appName); } catch(_) { app=firebase.initializeApp(c,appName); }
            firebaseStudioApp=app;
            firebaseStudioAuth=app.auth();
            firebaseStudioDb=app.firestore();
            try { await firebaseStudioAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); } catch(_) {}
            if(!firebaseStudioAuth.currentUser) {
                const cred=await firebaseStudioAuth.signInAnonymously();
                firebaseStudioUser=cred.user;
            } else firebaseStudioUser=firebaseStudioAuth.currentUser;
            return true;
        } catch(err) {
            console.error('Firebase Studio init failed',err);
            if(showResult) studioOutput('Firebase connection failed: '+err.message,'err');
            return false;
        }
    }

    function publicFirebaseDocToGame(doc) {
        const d=doc.data()||{};
        return {
            studioId:String(doc.id), remoteId:String(doc.id), public:true,
            title:d.title||'Untitled Place', description:d.description||'Made in Dohblox Studio.',
            owner:d.creatorName||'Builder', ownerUid:d.ownerUid||'',
            publishedAt:Number(d.createdAt)||0, updatedAt:Number(d.updatedAt)||0,
            world:d.gameData||studioDefaultWorld()
        };
    }

    async function refreshPublicStudioGames(refreshGrid=true,showResult=false) {
        if(publicStudioRefreshInFlight)return publicStudioRefreshInFlight;
        publicStudioRefreshInFlight=(async()=>{
            try {
                if(!await initFirebasePublicStudio(showResult)) return publicStudioGamesCache;
                const snap=await firebaseStudioDb.collection('dohblox_games').where('published','==',true).limit(250).get();
                publicStudioGamesCache=snap.docs.map(publicFirebaseDocToGame).sort((a,b)=>(b.updatedAt||b.publishedAt||0)-(a.updatedAt||a.publishedAt||0));
                rebuildStudioPublishedGameRecords(refreshGrid);
                if(showResult)studioOutput(`Firebase catalog connected — ${publicStudioGamesCache.length} community game(s) loaded.`,'ok');
                return publicStudioGamesCache;
            } catch(err) {
                console.error('Firebase public Studio refresh failed',err);
                if(showResult)studioOutput('Firebase catalog error: '+err.message,'err');
                return publicStudioGamesCache;
            } finally { publicStudioRefreshInFlight=null; }
        })();
        return publicStudioRefreshInFlight;
    }

    function initDohbloxStudioSync() {
        if ('BroadcastChannel' in window && !studioPublishChannel) {
            studioPublishChannel = new BroadcastChannel('dohblox_studio_publish_v3');
            studioPublishChannel.onmessage = (e) => {
                const msg=e.data||{};
                if(msg.type==='PUBLISH_SYNC' && msg.game){
                    let arr=[]; try{arr=JSON.parse(localStorage.getItem(STUDIO_PUBLISHED_KEY)||'[]')}catch(_){}
                    const idx=arr.findIndex(g=>String(g.studioId)===String(msg.game.studioId));
                    if(idx>=0) arr[idx]=msg.game; else arr.push(msg.game);
                    localStorage.setItem(STUDIO_PUBLISHED_KEY,JSON.stringify(arr));
                    loadPublishedStudioGames(true);
                    studioOutput(`Synced published game: ${msg.game.title}`,'ok');
                } else if(msg.type==='DELETE_SYNC' && msg.studioId){
                    let arr=[]; try{arr=JSON.parse(localStorage.getItem(STUDIO_PUBLISHED_KEY)||'[]')}catch(_){}
                    arr=arr.filter(g=>String(g.studioId)!==String(msg.studioId)); localStorage.setItem(STUDIO_PUBLISHED_KEY,JSON.stringify(arr));
                    loadPublishedStudioGames(true);
                } else if(msg.type==='PUBLIC_REFRESH') {
                    refreshPublicStudioGames(true);
                }
            };
        }
        window.addEventListener('storage', (e)=>{
            if(e.key===STUDIO_PUBLISHED_KEY) loadPublishedStudioGames(true);
            if(e.key===FIREBASE_STUDIO_SETTINGS_KEY){firebaseStudioApp=null;firebaseStudioAuth=null;firebaseStudioDb=null;firebaseStudioUser=null;refreshPublicStudioGames(true,true);}
        });
    }

    function getStoredPublishedStudioGames() {
        try { const a=JSON.parse(localStorage.getItem(STUDIO_PUBLISHED_KEY)||'[]'); return Array.isArray(a)?a:[]; } catch(e){ return []; }
    }

    function saveOwnedPublishedStudioGame(game,removeOldId=null) {
        let arr=getStoredPublishedStudioGames();
        if(removeOldId && String(removeOldId)!==String(game.studioId))arr=arr.filter(g=>String(g.studioId)!==String(removeOldId));
        const idx=arr.findIndex(g=>String(g.studioId)===String(game.studioId));
        if(idx>=0)arr[idx]=game;else arr.push(game);
        localStorage.setItem(STUDIO_PUBLISHED_KEY,JSON.stringify(arr));
    }

    function rebuildStudioPublishedGameRecords(refreshGrid=false) {
        gamesDatabase = gamesDatabase.filter(g=>g.type!=='studio_published');
        const merged=new Map();
        getStoredPublishedStudioGames().forEach(g=>merged.set(String(g.studioId),g));
        publicStudioGamesCache.forEach(g=>merged.set(String(g.studioId),g));
        Array.from(merged.values()).sort((a,b)=>(b.updatedAt||b.publishedAt||0)-(a.updatedAt||a.publishedAt||0)).forEach((g,i)=>{
            gamesDatabase.push({
                id:g.studioId || `studio_${i}`, studioId:g.studioId,
                title:g.title || 'Untitled Place', type:'studio_published',
                description:g.description || 'Made in Dohblox Studio.',
                studioWorld:g.world || studioDefaultWorld(), owner:g.owner || 'Builder', ownerUid:g.ownerUid||'',
                publishedAt:g.publishedAt || 0, public:!!g.public
            });
        });
        if(refreshGrid && document.getElementById('games-grid-container')) renderGamesGrid();
        renderStudioPublishedList();
        if (dohbloxCloudReady) setTimeout(() => syncDohbloxRoomDirectory(), 0);
    }

    function loadPublishedStudioGames(refreshGrid=false) {
        rebuildStudioPublishedGameRecords(refreshGrid);
        if(isFirebaseStudioConfigured())refreshPublicStudioGames(refreshGrid);
    }

    function renderStudioPublishedList() {
        const box=document.getElementById('studio-published-list'); if(!box) return;
        const games=getStoredPublishedStudioGames();
        if(!games.length){
            box.innerHTML='<div style="color:#999;padding:5px 0">You have not published a Studio game from this browser yet.</div>';
            return;
        }
        box.innerHTML='';
        games.slice().sort((a,b)=>(b.updatedAt||b.publishedAt||0)-(a.updatedAt||a.publishedAt||0)).forEach(g=>{
            const row=document.createElement('div'); row.className='studio-published-row';
            const badge=g.public?' <span style="color:#77d477">PUBLIC</span>':' <span style="color:#e7c76c">LOCAL</span>';
            row.innerHTML=`<span title="${studioEsc(g.description||'')}"><strong>${studioEsc(g.title)}</strong>${badge}<br><span style="color:#999">${studioEsc(g.owner||'Builder')}</span></span><span><button class="studio-small-btn">Edit</button> <button class="studio-small-btn">Delete</button></span>`;
            const btns=row.querySelectorAll('button');
            btns[0].onclick=()=>studioEditPublished(g.studioId);
            btns[1].onclick=()=>studioDeletePublished(g.studioId);
            box.appendChild(row);
        });
    }

    function studioEditPublished(id){
        const g=getStoredPublishedStudioGames().find(x=>String(x.studioId)===String(id)); if(!g)return;
        studioPushHistory(); studioWorld=studioClone(g.world); studioWorld.title=g.title; studioWorld.description=g.description;
        studioCurrentPublishedId=String(id); studioSelectedId=null; studioHistory=[]; studioRedoStack=[]; studioRebuildScene(); studioSyncProperties();
        studioOutput(`Opened ${g.public?'public':'local'} published place: ${g.title}`,'ok');
    }

    async function studioDeletePublished(id){
        const g=getStoredPublishedStudioGames().find(x=>String(x.studioId)===String(id));
        if(!g)return;
        if(!confirm(`Delete “${g.title}”${g.public?' from the public Dohblox catalog':''}?`))return;
        if(g.public){
            if(!await initFirebasePublicStudio(true)){alert('Connect Firebase before deleting this public game.');return;}
            if(!firebaseStudioUser || !g.ownerUid || g.ownerUid!==firebaseStudioUser.uid){alert('This browser is not signed in as the Firebase creator of that game, so it cannot delete it.');return;}
            try {
                await firebaseStudioDb.collection('dohblox_games').doc(String(id)).delete();
                await registerDohbloxRoom({id:String(id),studioId:String(id),title:g.title,type:'studio_published',description:g.description||'',owner:g.owner||'Builder',public:true}, false).catch(()=>{});
                dohbloxRoomDirectorySignature = '';
            }
            catch(err){studioOutput('Public delete failed: '+err.message,'err');alert('Could not delete the public game. Nothing was removed locally.');return;}
        }
        let a=getStoredPublishedStudioGames().filter(x=>String(x.studioId)!==String(id));localStorage.setItem(STUDIO_PUBLISHED_KEY,JSON.stringify(a));
        if(studioPublishChannel)studioPublishChannel.postMessage({type:'DELETE_SYNC',studioId:id});
        if(studioCurrentPublishedId===String(id))studioCurrentPublishedId=null;
        if(g.public)await refreshPublicStudioGames(true);else loadPublishedStudioGames(true);
        studioOutput(g.public?'Public game deleted.':'Local published game deleted.','warn');
    }

    function studioOutput(message,type=''){
        const o=document.getElementById('studio-output'); if(!o)return;
        const line=document.createElement('div'); line.className='studio-output-line '+type; line.textContent=`[${new Date().toLocaleTimeString()}] ${message}`; o.appendChild(line); o.scrollTop=o.scrollHeight;
    }

    function openDohbloxStudio(){
        if(activeGameTitle){alert('Leave the current game before opening Dohblox Studio.');return;}
        const modal=document.getElementById('dohblox-studio-modal'); modal.classList.remove('hidden');
        if(!studioWorld){
            let draft=null; try{draft=JSON.parse(localStorage.getItem(STUDIO_DRAFT_KEY)||'null')}catch(_){}
            studioWorld=draft&&draft.parts?draft:studioDefaultWorld();
        }
        if(!studioRenderer) initStudioRenderer();
        studioRebuildScene(); studioSyncProperties(); renderStudioPublishedList();
        setTimeout(studioResizeRenderer,30);
    }

    function closeDohbloxStudio(){ document.getElementById('dohblox-studio-modal').classList.add('hidden'); studioSaveDraft(true); }

    function studioNewPlace(){
        if(!confirm('Create a new place? Unsaved editor changes will be replaced.'))return;
        studioWorld=studioDefaultWorld(); studioCurrentPublishedId=null; studioSelectedId=null; studioHistory=[]; studioRedoStack=[];
        studioRebuildScene(); studioSyncProperties(); studioOutput('Created a new place.','ok');
    }

    function studioSaveDraft(silent=false){
        if(!studioWorld)return; localStorage.setItem(STUDIO_DRAFT_KEY,JSON.stringify(studioWorld));
        if(!silent)studioOutput('Draft saved locally.','ok');
    }

    function studioPushHistory(){
        if(!studioWorld)return; studioHistory.push(JSON.stringify(studioWorld)); if(studioHistory.length>60)studioHistory.shift(); studioRedoStack=[];
    }
    function studioUndo(){ if(!studioHistory.length)return; studioRedoStack.push(JSON.stringify(studioWorld)); studioWorld=JSON.parse(studioHistory.pop()); studioSelectedId=null; studioRebuildScene(); studioSyncProperties(); studioOutput('Undo.'); }
    function studioRedo(){ if(!studioRedoStack.length)return; studioHistory.push(JSON.stringify(studioWorld)); studioWorld=JSON.parse(studioRedoStack.pop()); studioSelectedId=null; studioRebuildScene(); studioSyncProperties(); studioOutput('Redo.'); }

    function studioSwitchLeftTab(tab){
        document.getElementById('studio-tab-explorer').classList.toggle('active',tab==='explorer');
        document.getElementById('studio-tab-toolbox').classList.toggle('active',tab==='toolbox');
        document.getElementById('studio-explorer-pane').classList.toggle('hidden',tab!=='explorer');
        document.getElementById('studio-toolbox-pane').classList.toggle('hidden',tab!=='toolbox');
    }

    function studioSetTool(tool){
        studioTool=tool; ['select','move','scale','rotate'].forEach(t=>{const b=document.getElementById(`studio-tool-${t}`);if(b)b.classList.toggle('active',t===tool)});
        const h=document.getElementById('studio-status-hint'); if(h)h.textContent=`${tool[0].toUpperCase()+tool.slice(1)} tool • RMB drag: orbit • Wheel: zoom`;
    }

    function studioPartDefaults(shape='block'){
        const names={block:'Part',ball:'Part',cylinder:'Part',wedge:'WedgePart'};
        return {id:studioNewId(shape),name:names[shape]||'Part',shape,pos:[0,3,0],size:shape==='ball'?[4,4,4]:[4,2,4],rot:[0,0,0],color:'#a3a3a3',material:'Plastic',transparency:0,anchored:true,canCollide:true,behavior:'none',behaviorValue:'',script:''};
    }

    function studioAddPart(shape='block'){
        studioPushHistory(); const p=studioPartDefaults(shape); studioWorld.parts.push(p); studioSelectedId=p.id; studioRebuildScene(); studioSyncProperties(); studioOutput(`Inserted ${shape}.`,'ok');
    }
    function studioAddSpawn(){
        studioPushHistory(); const p=studioPartDefaults('block'); p.name='SpawnLocation';p.isSpawn=true;p.size=[6,.5,6];p.pos=[0,.25,0];p.color='#5aa8ff';p.material='Neon';p.transparency=.15;studioWorld.parts.push(p);studioSelectedId=p.id;studioRebuildScene();studioSyncProperties();studioOutput('Inserted SpawnLocation.','ok');
    }
    function studioDeleteSelected(){if(!studioSelectedId)return;studioPushHistory();studioWorld.parts=studioWorld.parts.filter(p=>p.id!==studioSelectedId);studioSelectedId=null;studioRebuildScene();studioSyncProperties();}
    function studioDuplicateSelected(){const p=studioGetSelected();if(!p)return;studioPushHistory();const q=studioClone(p);q.id=studioNewId(q.shape);q.name=p.name+' Copy';q.pos=[p.pos[0]+2,p.pos[1]+1,p.pos[2]+2];studioWorld.parts.push(q);studioSelectedId=q.id;studioRebuildScene();studioSyncProperties();}
    function studioGetSelected(){return studioWorld&&studioWorld.parts.find(p=>p.id===studioSelectedId)||null;}

    function studioInsertTemplate(kind){
        studioPushHistory(); const add=(p)=>studioWorld.parts.push(p); const mk=(name,pos,size,color,opts={})=>{const p=studioPartDefaults(opts.shape||'block');p.name=name;p.pos=pos;p.size=size;p.color=color;Object.assign(p,opts);add(p);return p;};
        if(kind==='tree'){mk('Trunk',[0,3,0],[2,6,2],'#75421f',{material:'Wood'});mk('Leaves',[0,7,0],[7,5,7],'#3d8d37',{shape:'ball',material:'Plastic'});}
        else if(kind==='house'){
            mk('Floor',[0,.25,0],[18,.5,16],'#b88452',{material:'Wood'});mk('BackWall',[0,4,-8],[18,8,.6],'#e3cfaa',{material:'Brick'});mk('LeftWall',[-9,4,0],[.6,8,16],'#e3cfaa',{material:'Brick'});mk('RightWall',[9,4,0],[.6,8,16],'#e3cfaa',{material:'Brick'});mk('FrontLeft',[-5.5,4,8],[7,8,.6],'#e3cfaa',{material:'Brick'});mk('FrontRight',[5.5,4,8],[7,8,.6],'#e3cfaa',{material:'Brick'});mk('Roof',[0,8.4,0],[19,.8,17],'#9e3939',{material:'Brick'});
        } else if(kind==='obby'){for(let i=0;i<8;i++)mk('ObbyPlatform '+(i+1),[-14+i*4,1.5+i*.7,-4+i*3],[4,.6,4],['#ed5555','#55a5ed','#55c875','#f0d34e'][i%4],{});}
        else if(kind==='lava'){const p=mk('Lava',[0,.25,0],[14,.5,14],'#ff3b18',{material:'Neon',behavior:'damage',behaviorValue:'35'});studioSelectedId=p.id;}
        else if(kind==='stairs'){for(let i=0;i<8;i++)mk('Step '+(i+1),[0,.5+i*.5,-7+i*2],[8,1,2],'#9c9c9c',{material:'Concrete'});}
        studioRebuildScene();studioSyncProperties();studioOutput(`Inserted ${kind} template.`,'ok');
    }

    function studioMaterialForPart(p){
        const color=new THREE.Color(p.color||'#aaaaaa'); const trans=Math.min(.95,Math.max(0,studioSafeNum(p.transparency,0))); const common={color,transparent:trans>0,opacity:1-trans};
        if(p.material==='Neon')return new THREE.MeshBasicMaterial(common);
        if(p.material==='Metal')return new THREE.MeshStandardMaterial({...common,metalness:.75,roughness:.28});
        if(p.material==='Glass')return new THREE.MeshPhongMaterial({...common,transparent:true,opacity:Math.min(.55,1-trans),shininess:90});
        return new THREE.MeshLambertMaterial(common);
    }
    function studioGeometryForPart(p){
        const s=p.size||[4,2,4];
        if(p.shape==='ball')return new THREE.SphereGeometry(.5,18,14);
        if(p.shape==='cylinder')return new THREE.CylinderGeometry(.5,.5,1,18);
        if(p.shape==='wedge'){
            const g=new THREE.BufferGeometry();
            const v=new Float32Array([-0.5,-0.5,-0.5, 0.5,-0.5,-0.5, -0.5,-0.5,0.5, 0.5,-0.5,0.5, -0.5,0.5,-0.5, 0.5,0.5,-0.5]);
            const idx=[0,2,1,1,2,3, 0,1,4,1,5,4, 0,4,2,2,4,3, 1,3,5,3,4,5, 4,5,3];
            g.setAttribute('position',new THREE.BufferAttribute(v,3));g.setIndex(idx);g.computeVertexNormals();return g;
        }
        return new THREE.BoxGeometry(1,1,1);
    }
    function studioCreateMesh(p){
        const mesh=new THREE.Mesh(studioGeometryForPart(p),studioMaterialForPart(p)); const s=p.size||[4,2,4];
        mesh.scale.set(Math.max(.1,s[0]),Math.max(.1,s[1]),Math.max(.1,s[2])); mesh.position.set(...(p.pos||[0,0,0]));
        const r=p.rot||[0,0,0];mesh.rotation.set(THREE.MathUtils.degToRad(r[0]||0),THREE.MathUtils.degToRad(r[1]||0),THREE.MathUtils.degToRad(r[2]||0));mesh.userData.studioId=p.id;mesh.userData.isStudioPart=true;
        return mesh;
    }

    function initStudioRenderer(){
        const host=document.getElementById('studio-viewport'); studioRenderer=new THREE.WebGLRenderer({antialias:true});studioRenderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1));host.insertBefore(studioRenderer.domElement,host.firstChild);
        studioCamera=new THREE.PerspectiveCamera(60,1,.1,1000); studioRenderer.domElement.tabIndex=0;
        const c=studioRenderer.domElement;
        c.addEventListener('contextmenu',e=>e.preventDefault());
        c.addEventListener('pointerdown',studioPointerDown); window.addEventListener('pointermove',studioPointerMove);window.addEventListener('pointerup',studioPointerUp);
        c.addEventListener('wheel',e=>{e.preventDefault();studioCameraDistance=Math.max(5,Math.min(180,studioCameraDistance+e.deltaY*.025));},{passive:false});
        window.addEventListener('resize',studioResizeRenderer); studioAnimate();
    }
    function studioResizeRenderer(){if(!studioRenderer)return;const host=document.getElementById('studio-viewport');const w=Math.max(100,host.clientWidth),h=Math.max(100,host.clientHeight);studioRenderer.setSize(w,h,false);studioCamera.aspect=w/h;studioCamera.updateProjectionMatrix();}
    function studioAnimate(){studioAnimId=requestAnimationFrame(studioAnimate);if(!studioRenderer||!studioScene||document.getElementById('dohblox-studio-modal').classList.contains('hidden'))return;const cp=Math.cos(studioCameraPitch);studioCamera.position.set(studioCameraTarget.x+studioCameraDistance*Math.sin(studioCameraYaw)*cp,studioCameraTarget.y+studioCameraDistance*Math.sin(studioCameraPitch),studioCameraTarget.z+studioCameraDistance*Math.cos(studioCameraYaw)*cp);studioCamera.lookAt(studioCameraTarget);studioRenderer.render(studioScene,studioCamera);}

    function studioRebuildScene(){
        if(!studioRenderer||!studioWorld)return;studioScene=new THREE.Scene();studioScene.background=new THREE.Color(studioWorld.skyColor||'#7db7eb');
        const hemi=new THREE.HemisphereLight(0xffffff,0x667788,.9),sun=new THREE.DirectionalLight(0xffffff,1.05);sun.position.set(20,40,15);studioScene.add(hemi,sun);
        const grid=new THREE.GridHelper(200,100,0x73777f,0x9ba0a8);grid.position.y=.01;studioScene.add(grid);
        studioWorld.parts.forEach(p=>studioScene.add(studioCreateMesh(p)));
        if(studioSelectedId){const m=studioScene.children.find(o=>o.userData&&o.userData.studioId===studioSelectedId);if(m){studioSelectionHelper=new THREE.BoxHelper(m,0x00a8ff);studioScene.add(studioSelectionHelper);}else studioSelectedId=null;}
        studioRenderExplorer();studioResizeRenderer();
    }

    function studioRenderExplorer(){
        const box=document.getElementById('studio-explorer-list');if(!box||!studioWorld)return;box.innerHTML='';studioWorld.parts.forEach(p=>{const row=document.createElement('div');row.className='studio-tree-row'+(p.id===studioSelectedId?' selected':'');row.textContent=(p.isSpawn?'◆ ':p.shape==='ball'?'● ':p.shape==='cylinder'?'⬭ ':p.shape==='wedge'?'◢ ':'■ ')+(p.name||'Part');row.onclick=()=>{studioSelectedId=p.id;studioRebuildScene();studioSyncProperties()};box.appendChild(row)});
    }

    function studioNDCFromEvent(e){const r=studioRenderer.domElement.getBoundingClientRect();return new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1,-((e.clientY-r.top)/r.height)*2+1)}
    function studioRaycastPart(e){const ray=new THREE.Raycaster();ray.setFromCamera(studioNDCFromEvent(e),studioCamera);const hits=ray.intersectObjects(studioScene.children.filter(o=>o.userData&&o.userData.isStudioPart),false);return hits[0]||null;}
    function studioPointerDown(e){
        if(e.button===2){studioPointerMode='orbit';studioPointerStart={x:e.clientX,y:e.clientY,yaw:studioCameraYaw,pitch:studioCameraPitch};return;}
        if(e.button!==0)return;const hit=studioRaycastPart(e);if(hit){studioSelectedId=hit.object.userData.studioId;studioRebuildScene();studioSyncProperties();if(studioTool!=='select'){studioPushHistory();studioPointerMode=studioTool;studioPointerStart={x:e.clientX,y:e.clientY};studioStartPartState=studioClone(studioGetSelected());}}
        else if(studioTool==='select'){studioSelectedId=null;studioRebuildScene();studioSyncProperties();}
    }
    function studioPointerMove(e){
        if(!studioPointerMode)return;
        if(studioPointerMode==='orbit'){const dx=e.clientX-studioPointerStart.x,dy=e.clientY-studioPointerStart.y;studioCameraYaw=studioPointerStart.yaw-dx*.007;studioCameraPitch=Math.max(-.2,Math.min(1.35,studioPointerStart.pitch+dy*.006));return;}
        const p=studioGetSelected();if(!p||!studioStartPartState)return;const dx=e.clientX-studioPointerStart.x,dy=e.clientY-studioPointerStart.y;
        if(studioPointerMode==='move'){
            const ndc=studioNDCFromEvent(e),ray=new THREE.Raycaster();ray.setFromCamera(ndc,studioCamera);const plane=new THREE.Plane(new THREE.Vector3(0,1,0),-studioStartPartState.pos[1]);const out=new THREE.Vector3();if(ray.ray.intersectPlane(plane,out)){p.pos=[Math.round(out.x*2)/2,studioStartPartState.pos[1],Math.round(out.z*2)/2];}
        }else if(studioPointerMode==='scale'){const d=(dx-dy)*.03;p.size=studioStartPartState.size.map(v=>Math.max(.2,Math.round((v+d)*10)/10));}
        else if(studioPointerMode==='rotate'){p.rot=[studioStartPartState.rot[0],Math.round((studioStartPartState.rot[1]+dx*.5)/5)*5,studioStartPartState.rot[2]];}
        studioRebuildScene();studioSyncProperties();
    }
    function studioPointerUp(){studioPointerMode=null;studioPointerStart=null;studioStartPartState=null;}

    function studioSyncProperties(){
        if(!studioWorld)return;document.getElementById('studio-place-name').value=studioWorld.title||'My Place';document.getElementById('studio-sky-color').value=studioWorld.skyColor||'#7db7eb';document.getElementById('studio-gravity').value=studioWorld.gravity??1;document.getElementById('studio-starter-gear').value=studioWorld.starterGear||'none';document.getElementById('studio-window-title').textContent='— '+(studioWorld.title||'My Place');
        const p=studioGetSelected(),ids=['studio-prop-name','studio-prop-px','studio-prop-py','studio-prop-pz','studio-prop-sx','studio-prop-sy','studio-prop-sz','studio-prop-rx','studio-prop-ry','studio-prop-rz','studio-prop-color','studio-prop-material','studio-prop-trans','studio-prop-anchored','studio-prop-collide','studio-prop-behavior','studio-prop-value','studio-prop-script'];ids.forEach(id=>{const e=document.getElementById(id);if(e)e.disabled=!p});document.getElementById('studio-selected-label').textContent=p?p.name:'Workspace';if(!p)return;
        document.getElementById('studio-prop-name').value=p.name||'Part';['x','y','z'].forEach((a,i)=>document.getElementById('studio-prop-p'+a).value=p.pos[i]);['x','y','z'].forEach((a,i)=>document.getElementById('studio-prop-s'+a).value=p.size[i]);['x','y','z'].forEach((a,i)=>document.getElementById('studio-prop-r'+a).value=p.rot[i]);document.getElementById('studio-prop-color').value=p.color||'#aaaaaa';document.getElementById('studio-prop-material').value=p.material||'Plastic';document.getElementById('studio-prop-trans').value=p.transparency||0;document.getElementById('studio-prop-anchored').checked=p.anchored!==false;document.getElementById('studio-prop-collide').checked=p.canCollide!==false;document.getElementById('studio-prop-behavior').value=p.behavior||'none';document.getElementById('studio-prop-value').value=p.behaviorValue||'';document.getElementById('studio-prop-script').value=p.script||'';
    }
    function studioApplyPlaceProperties(){if(!studioWorld)return;studioPushHistory();studioWorld.title=document.getElementById('studio-place-name').value.trim()||'My Place';studioWorld.skyColor=document.getElementById('studio-sky-color').value;studioWorld.gravity=Math.max(0,Math.min(3,studioSafeNum(document.getElementById('studio-gravity').value,1)));studioWorld.starterGear=document.getElementById('studio-starter-gear').value;studioRebuildScene();studioSyncProperties();}
    function studioApplySelectedProperties(){const p=studioGetSelected();if(!p)return;studioPushHistory();p.name=document.getElementById('studio-prop-name').value||'Part';p.pos=['x','y','z'].map(a=>studioSafeNum(document.getElementById('studio-prop-p'+a).value));p.size=['x','y','z'].map(a=>Math.max(.2,studioSafeNum(document.getElementById('studio-prop-s'+a).value,1)));p.rot=['x','y','z'].map(a=>studioSafeNum(document.getElementById('studio-prop-r'+a).value));p.color=document.getElementById('studio-prop-color').value;p.material=document.getElementById('studio-prop-material').value;p.transparency=Math.max(0,Math.min(1,studioSafeNum(document.getElementById('studio-prop-trans').value)));p.anchored=document.getElementById('studio-prop-anchored').checked;p.canCollide=document.getElementById('studio-prop-collide').checked;p.behavior=document.getElementById('studio-prop-behavior').value;p.behaviorValue=document.getElementById('studio-prop-value').value;p.script=document.getElementById('studio-prop-script').value;studioRebuildScene();studioSyncProperties();}

    function studioShowPublishDialog(){document.getElementById('studio-publish-name').value=studioWorld.title||'My Dohblox Place';document.getElementById('studio-publish-description').value=studioWorld.description||'Made in Dohblox Studio.';document.getElementById('studio-publish-dialog').classList.remove('hidden');}
    function studioHidePublishDialog(){document.getElementById('studio-publish-dialog').classList.add('hidden');}
    async function studioPublishPlace(){
        const title=document.getElementById('studio-publish-name').value.trim();
        if(!title){alert('Give your game a name first.');return;}
        const desc=document.getElementById('studio-publish-description').value.trim();
        studioWorld.title=title;studioWorld.description=desc;
        const worldCopy=studioClone(studioWorld);
        const approxBytes=new Blob([JSON.stringify(worldCopy)]).size;
        if(approxBytes>850000){alert('This place is too large for one public Firebase game document. Reduce the number/size of Studio parts, then publish again.');return;}

        if(!isFirebaseStudioConfigured()){
            const ok=confirm('Firebase public sharing is not configured yet. Press OK to save this game locally only, or Cancel and use Firebase Setup first.');
            if(!ok)return;
            let id=studioCurrentPublishedId||('studio_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7));
            const now=Date.now();
            const game={studioId:id,title,description:desc,owner:currentUser.username||'Builder',publishedAt:now,updatedAt:now,world:worldCopy,public:false};
            saveOwnedPublishedStudioGame(game);studioCurrentPublishedId=String(id);studioSaveDraft(true);
            if(studioPublishChannel)studioPublishChannel.postMessage({type:'PUBLISH_SYNC',game});
            loadPublishedStudioGames(true);studioHidePublishDialog();studioOutput(`Saved “${title}” locally. Use Firebase Setup to share it with everyone.`,'warn');
            return;
        }

        if(!await initFirebasePublicStudio(true)){alert('Firebase could not connect. Your Studio draft is still safe.');return;}
        const uid=firebaseStudioUser&&firebaseStudioUser.uid;
        if(!uid){alert('Firebase anonymous sign-in failed. Enable Anonymous Authentication in Firebase.');return;}

        const oldId=studioCurrentPublishedId;
        const oldLocal=oldId?getStoredPublishedStudioGames().find(g=>String(g.studioId)===String(oldId)):null;
        const canUpdate=!!(oldLocal&&oldLocal.public&&oldLocal.ownerUid===uid);
        const id=canUpdate?String(oldId):('studio_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8));
        const now=Date.now();
        const createdAt=canUpdate?(oldLocal.publishedAt||oldLocal.createdAt||now):now;
        studioOutput(canUpdate?`Updating public game “${title}”…`:`Publishing “${title}” to Firebase…`);
        try {
            const payload={
                title:title.slice(0,48),
                description:desc.slice(0,180),
                creatorName:String(currentUser.username||'Builder').slice(0,32),
                ownerUid:uid,
                published:true,
                createdAt,
                updatedAt:now,
                gameData:worldCopy
            };
            await firebaseStudioDb.collection('dohblox_games').doc(id).set(payload,{merge:canUpdate});
            const game={id:id,studioId:id,remoteId:id,title,description:desc,type:'studio_published',owner:currentUser.username||'Builder',ownerUid:uid,publishedAt:createdAt,updatedAt:now,world:worldCopy,studioWorld:worldCopy,public:true};
            saveOwnedPublishedStudioGame(game,oldId);studioCurrentPublishedId=id;studioSaveDraft(true);
            await registerDohbloxRoom(game, true);
            dohbloxRoomDirectorySignature = '';
            if(studioPublishChannel){studioPublishChannel.postMessage({type:'PUBLISH_SYNC',game});studioPublishChannel.postMessage({type:'PUBLIC_REFRESH'});}
            await refreshPublicStudioGames(true);
            studioHidePublishDialog();studioOutput(`Published “${title}” publicly with Firebase. Everyone using the same Dohblox Firebase project can now see and play it.`,'ok');
        } catch(err) {
            console.error(err);studioOutput('Firebase publish failed: '+err.message,'err');
            alert('Public publish failed. Your Studio draft is still safe. Check Firebase Setup, enable Anonymous Authentication, create Firestore, and install the supplied Firestore rules.');
        }
    }

    function studioExportPlace(){const blob=new Blob([JSON.stringify(studioWorld,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(studioWorld.title||'dohblox-place').replace(/[^a-z0-9_-]+/gi,'_')+'.dohplace.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),500);studioOutput('Place exported as JSON.','ok');}
    function studioImportPlace(e){const f=e.target.files&&e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{const w=JSON.parse(r.result);if(!w||!Array.isArray(w.parts))throw new Error('Invalid place file');studioPushHistory();studioWorld=w;studioCurrentPublishedId=null;studioSelectedId=null;studioRebuildScene();studioSyncProperties();studioOutput('Place imported.','ok')}catch(err){alert('Could not import this place file.');studioOutput(String(err),'err')}};r.readAsText(f);e.target.value='';}

    function studioPlayTest(){
        const testId='__studio_test_'+Date.now();const testTitle='Studio Test: '+(studioWorld.title||'Place');const rec={id:testId,title:testTitle,type:'studio_published',description:'Studio test session',studioWorld:studioClone(studioWorld),temporary:true};gamesDatabase.push(rec);studioReturnAfterTest=true;closeDohbloxStudio();launchGame(testTitle,testId);
    }

    function buildStudioPublishedWorld(world){
        cleanupStudioPublishedRuntime();const w=world||studioDefaultWorld();studioRuntimeGravity=Math.max(0,Math.min(3,studioSafeNum(w.gravity,1)));gameScene.background=new THREE.Color(w.skyColor||'#7db7eb');studioPublishedSpawn=null;
        (w.parts||[]).forEach(p=>{
            const mesh=studioCreateMesh(p);mesh.userData.studioRuntime=true;gameScene.add(mesh);let collider=null;if(p.canCollide!==false){collider=new THREE.Box3().setFromObject(mesh);gameColliders.push(collider);}if(p.isSpawn&&!studioPublishedSpawn)studioPublishedSpawn={x:(p.pos?.[0]||0),y:(p.pos?.[1]||0)+(p.size?.[1]||.5)/2+.15,z:(p.pos?.[2]||0)};studioRuntimeParts.push({part:studioClone(p),mesh,collider,lastTouch:0,hiddenUntil:0,baseRotY:mesh.rotation.y});
        });
        if(!studioPublishedSpawn)studioPublishedSpawn={x:0,y:4,z:0};
        addChatMessageUI('Studio',`Playing ${w.title||'published place'} — built in Dohblox Studio.`);
    }
    function cleanupStudioPublishedRuntime(){studioRuntimeParts=[];studioRuntimeGravity=1;studioPublishedSpawn=null;studioRuntimeTouchTimes.clear();}

    function parseStudioDohScript(part){
        const cmds=[];const text=String(part.script||'').trim();if(text){text.split(/\n|;/).map(s=>s.trim()).filter(Boolean).forEach(line=>{const [cmd,...rest]=line.split(/\s+/);cmds.push({cmd:(cmd||'').toLowerCase(),value:rest.join(' ')})});}
        if(part.behavior&&part.behavior!=='none')cmds.push({cmd:part.behavior,value:String(part.behaviorValue||'')});return cmds;
    }
    function updateStudioPublishedRuntime(dt,playerBox){
        if(!(activeGameRecord&&activeGameRecord.type==='studio_published'))return;const now=performance.now();studioRuntimeParts.forEach(o=>{
            const p=o.part,cmds=parseStudioDohScript(p);let spinning=false;cmds.forEach(c=>{if(c.cmd==='spin'){const speed=studioSafeNum(c.value,30);o.mesh.rotation.y+=THREE.MathUtils.degToRad(speed)*dt;spinning=true;}});if(spinning&&o.collider)o.collider.setFromObject(o.mesh);
            if(o.hiddenUntil&&now>=o.hiddenUntil){o.hiddenUntil=0;o.mesh.visible=true;if(o.collider)o.collider.setFromObject(o.mesh);}
            if(!o.mesh.visible||!o.collider||!playerBox.intersectsBox(o.collider)||now-o.lastTouch<500)return;o.lastTouch=now;
            cmds.forEach(c=>{
                if(c.cmd==='damage'){updateHealthUI(playerHealth-Math.max(1,studioSafeNum(c.value,25)));if(playerHealth<=0){playerPos={...studioPublishedSpawn};updateHealthUI(100);activateLocalSpawnShield(3000,true);}}
                else if(c.cmd==='kill'){playerPos={...studioPublishedSpawn};playerVelocityY=0;updateHealthUI(100);activateLocalSpawnShield(3000,true);}
                else if(c.cmd==='bounce'){playerVelocityY=Math.max(.25,studioSafeNum(c.value,.45));}
                else if(c.cmd==='conveyor'){const sp=studioSafeNum(c.value,.08);playerPos.x+=Math.sin(o.mesh.rotation.y)*sp;playerPos.z+=Math.cos(o.mesh.rotation.y)*sp;}
                else if(c.cmd==='disappear'){o.mesh.visible=false;o.hiddenUntil=now+Math.max(500,studioSafeNum(c.value,3)*1000);if(o.collider)o.collider.makeEmpty();}
                else if(c.cmd==='teleport'){const v=String(c.value||'').split(/[ ,]+/).map(Number);if(v.length>=3&&v.every(Number.isFinite)){playerPos={x:v[0],y:v[1],z:v[2]};playerVelocityY=0;}}
                else if(c.cmd==='message'){addChatMessageUI(p.name||'Part',c.value||'Touched!');}
            });
        });
    }


    /* ============================================================
       DOHBLOX NATURAL DISASTER SURVIVAL
       Original implementation inspired by the classic disaster-survival
       loop. Map geometry is original/simplified; roster and gameplay systems
       are recreated for Dohblox.
       ============================================================ */
    const NDS_MAPS = [
        'Arch Park','Coastal Quickstop','Devastation Station','Factory Frenzy','Fort Indestructible',
        'Furious Station','Glass Office','Happy Home','Heights School','Launch Land','Lucky Mart',
        'Manic Mansion','Modest Headquarters','Party Palace','Prison Panic','Rainbow Ride',
        'Rakish Refinery','Raving Raceway','Safety Second','Sky Tower','Sunny Ranch','Surf Central','Trailer Park'
    ];
    const NDS_DISASTERS = [
        'Acid Rain','Avalanche','Blizzard','Deadly Virus','Earthquake','Fire','Flash Flood',
        'Meteor Shower','Sandstorm','Thunderstorm','Tornado','Tsunami','Volcanic Eruption'
    ];
    const NDS_ISLAND_Z = -95;
    const NDS_LOBBY_Z = 72;
    const NDS_WEATHER_BOOST_COST = 75;
    const NDS_MAX_WEATHER_POWER = 3;

    let ndsLobbyRoot = null, ndsMapRoot = null, ndsEffectsRoot = null;
    let ndsMapColliders = [], ndsBreakables = [], ndsEffectObjects = [];
    let ndsHudEl = null, ndsWeatherMachine = null, ndsWeatherMachineRing = null;
    let ndsPhase = 'lobby', ndsPhaseEndsAt = 0, ndsRoundId = 0;
    let ndsCurrentMapIndex = 0, ndsCurrentDisasters = [], ndsWeatherPower = 0;
    let ndsPreferredMapIndex = -1, ndsPlayerAlive = true, ndsRoundStartedAlive = false;
    let ndsInfected = false, ndsBalloonActive = false, ndsAppleCooldownUntil = 0;
    let ndsNextDamageAt = 0, ndsNextLightningAt = 0, ndsNextMeteorAt = 0, ndsNextAvalancheAt = 0;
    let ndsNextVolcanoAt = 0, ndsNextFireSpreadAt = 0, ndsNextVirusSpreadAt = 0;
    let ndsTsunami = null, ndsTornado = null, ndsFloodWater = null, ndsVolcano = null, ndsMountain = null;
    let ndsWeatherParticles = [], ndsMeteors = [], ndsSnowChunks = [], ndsFireSpots = [], ndsTornadoDebris = [], ndsVolcanoSmoke = [];
    let ndsStateStarted = false, ndsStateSyncTimer = null;
    let ndsSoundLoopTimer = null, ndsLastImpactSoundAt = 0;

    function isNaturalDisasterActive() {
        return !!activeGameTitle && activeGameTitle.includes('Natural Disaster');
    }


    // NATURAL DISASTER PERMANENT FLOOR SAFETY
    // Keeps the lobby/island base solid even if a round rebuild swaps collider references
    // or a slow frame makes gravity step just past the thin top surface.
    function resolveNaturalDisasterFloorSafety() {
        if (!isNaturalDisasterActive()) return;
        const onLobbyBase = Math.abs(playerPos.x) <= 28 && Math.abs(playerPos.z - NDS_LOBBY_Z) <= 23;
        const onIslandBase = Math.abs(playerPos.x) <= 54 && Math.abs(playerPos.z - NDS_ISLAND_Z) <= 54;
        if ((onLobbyBase || onIslandBase) && playerVelocityY <= 0 && playerPos.y < 0.02) {
            playerPos.y = 0;
            playerVelocityY = 0;
            isGrounded = true;
        }
    }

    function ensureNDSProgress() {
        if (!Number.isFinite(currentUser.ndsSurvivals)) currentUser.ndsSurvivals = 0;
    }

    function ensureNDSHud() {
        if (ndsHudEl && document.body.contains(ndsHudEl)) return ndsHudEl;
        const host = document.getElementById('game-canvas-container');
        if (!host) return null;
        ndsHudEl = document.createElement('div');
        ndsHudEl.id = 'nds-hud';
        ndsHudEl.style.cssText = 'position:absolute;top:54px;left:50%;transform:translateX(-50%);z-index:2004;min-width:300px;max-width:78vw;background:rgba(0,0,0,.72);border:2px solid rgba(255,255,255,.65);border-radius:6px;color:#fff;text-align:center;padding:8px 12px;font:700 12px Arial;pointer-events:none;text-shadow:1px 1px 2px #000;';
        host.appendChild(ndsHudEl);
        return ndsHudEl;
    }

    function updateNDSHud() {
        if (!isNaturalDisasterActive()) return;
        ensureNDSProgress();
        const hud = ensureNDSHud();
        if (!hud) return;
        const remaining = Math.max(0, Math.ceil((ndsPhaseEndsAt - Date.now()) / 1000));
        const phaseLabel = ndsPhase === 'lobby' ? 'Next round' : ndsPhase === 'prep' ? 'Get ready' : ndsPhase === 'disaster' ? 'SURVIVE!' : 'Round over';
        const map = NDS_MAPS[ndsCurrentMapIndex] || 'Unknown';
        const disaster = ndsPhase === 'disaster' ? (ndsCurrentDisasters.join(' + ') || 'Unknown') : (ndsCurrentDisasters.length ? ndsCurrentDisasters.join(' + ') : 'Hidden until round starts');
        hud.innerHTML = `<div style="font-size:16px;color:#ffef76">${phaseLabel} • ${remaining}s</div>` +
            `<div>Map: <span style="color:#8fd3ff">${map}</span></div>` +
            `<div>Disaster: <span style="color:#ff9e8f">${disaster}</span></div>` +
            `<div>Survivals: ${currentUser.ndsSurvivals} • Weather Machine: +${ndsWeatherPower} disaster${ndsWeatherPower===1?'':'s'} next round</div>` +
            `<div style="font-size:10px;color:#ddd">Weather boost costs B ${NDS_WEATHER_BOOST_COST} Dohbux • Power ${ndsWeatherPower}/${NDS_MAX_WEATHER_POWER}</div>`;
    }

    function ndsAddBox(root, x, y, z, w, h, d, color, collide=true, breakable=true, opacity=1) {
        const mat = new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity });
        const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat);
        m.position.set(x,y,z); root.add(m);
        if (collide) {
            const c = new THREE.Box3().setFromObject(m);
            gameColliders.push(c); ndsMapColliders.push(c); m.userData.ndsCollider = c;
        }
        if (breakable) ndsBreakables.push(m);
        return m;
    }

    function ndsAddCylinder(root, x,y,z, r,h,color, collide=true, breakable=true, segments=16) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,segments), new THREE.MeshLambertMaterial({color}));
        m.position.set(x,y,z); root.add(m);
        if (collide) { const c=new THREE.Box3().setFromObject(m); gameColliders.push(c); ndsMapColliders.push(c); m.userData.ndsCollider=c; }
        if (breakable) ndsBreakables.push(m);
        return m;
    }

    function ndsAddStairs(root, x,y,z, count, dir='z', color=0x999999) {
        for(let i=0;i<count;i++) {
            const sx = dir==='x' ? x + i*1.5 : x;
            const sz = dir==='z' ? z + i*1.5 : z;
            ndsAddBox(root,sx,y+i*.65,sz,3,.65,3,color,true,true);
        }
    }

    function clearNDSMap() {
        if (ndsMapRoot && gameScene) gameScene.remove(ndsMapRoot);
        if (ndsEffectsRoot && gameScene) gameScene.remove(ndsEffectsRoot);
        if (ndsMapColliders.length) {
            const refs = new Set(ndsMapColliders);
            gameColliders = gameColliders.filter(c => !refs.has(c));
        }
        ndsMapColliders=[]; ndsBreakables=[]; ndsEffectObjects=[];
        ndsWeatherParticles=[]; ndsMeteors=[]; ndsSnowChunks=[]; ndsFireSpots=[];
        ndsTsunami=null; ndsTornado=null; ndsFloodWater=null; ndsVolcano=null; ndsMountain=null; ndsTornadoDebris=[]; ndsVolcanoSmoke=[]; stopNDSAmbience();
        ndsMapRoot=null; ndsEffectsRoot=null;
    }

    function buildNDSLobby() {
        ndsLobbyRoot = new THREE.Group(); ndsLobbyRoot.name='ndsLobbyRoot'; gameScene.add(ndsLobbyRoot);
        const ground = ndsAddBox(ndsLobbyRoot,0,-1,NDS_LOBBY_Z,56,2,46,0x5d9e45,true,false);
        const pad = ndsAddBox(ndsLobbyRoot,0,.25,NDS_LOBBY_Z,18,.5,14,0xb9b9b9,true,false);
        ndsAddBox(ndsLobbyRoot,-14,2.5,NDS_LOBBY_Z-4,8,5,8,0xb7c0c6,true,false);
        ndsAddBox(ndsLobbyRoot,-14,6.2,NDS_LOBBY_Z-4,7,1,7,0x555b62,true,false);
        ndsAddStairs(ndsLobbyRoot,-14,.4,NDS_LOBBY_Z+3,7,'z',0xa4a4a4);
        const tower = ndsAddBox(ndsLobbyRoot,15,6,NDS_LOBBY_Z-5,8,12,8,0xc5cbd0,true,false);
        for(let y=1;y<=10;y+=3) ndsAddBox(ndsLobbyRoot,15,y,NDS_LOBBY_Z-9.1,5.5,.25,.2,0x4d90a8,false,false);
        ndsWeatherMachine = ndsAddCylinder(ndsLobbyRoot,7,1.3,NDS_LOBBY_Z+5,2,2.6,0x2c72c9,true,false,20);
        ndsWeatherMachineRing = new THREE.Mesh(new THREE.TorusGeometry(2.8,.22,8,24), new THREE.MeshBasicMaterial({color:0x66ccff}));
        ndsWeatherMachineRing.rotation.x=Math.PI/2; ndsWeatherMachineRing.position.set(7,2.8,NDS_LOBBY_Z+5); ndsLobbyRoot.add(ndsWeatherMachineRing);
        const sign = ndsAddBox(ndsLobbyRoot,7,4.5,NDS_LOBBY_Z+5,7,2,.3,0x1b3457,false,false);
        const canvas=document.createElement('canvas'); canvas.width=512; canvas.height=160; const ctx=canvas.getContext('2d');
        ctx.fillStyle='#173657';ctx.fillRect(0,0,512,160);ctx.fillStyle='#fff';ctx.font='900 40px Arial';ctx.textAlign='center';ctx.fillText('WEATHER MACHINE',256,58);ctx.font='700 25px Arial';ctx.fillStyle='#8fe7ff';ctx.fillText(`B ${NDS_WEATHER_BOOST_COST} = +1 DISASTER`,256,105);ctx.fillStyle='#ddd';ctx.font='18px Arial';ctx.fillText('E / USE TO BOOST NEXT ROUND',256,137);
        sign.material = new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(canvas)});
        const board = ndsAddBox(ndsLobbyRoot,-2,5,NDS_LOBBY_Z-10,15,7,.35,0x222222,false,false);
        const c2=document.createElement('canvas');c2.width=700;c2.height=340;const q=c2.getContext('2d');q.fillStyle='#111';q.fillRect(0,0,700,340);q.fillStyle='#ffd84a';q.font='900 48px Arial';q.textAlign='center';q.fillText('DOHBLOX DISASTER SURVIVAL',350,60);q.fillStyle='#fff';q.font='27px Arial';q.fillText('Survive the disaster on the island!',350,120);q.fillText('Red Apple • Green Balloon • Yellow Compass',350,170);q.fillText('Weather Machine adds disasters to the next round.',350,220);q.fillStyle='#8fd3ff';q.fillText('Your survivals save to your account.',350,275);board.material=new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c2)});
    }

    function ndsMapBase() {
        ndsMapRoot = new THREE.Group(); ndsMapRoot.name='ndsMapRoot'; gameScene.add(ndsMapRoot);
        ndsEffectsRoot = new THREE.Group(); ndsEffectsRoot.name='ndsEffectsRoot'; gameScene.add(ndsEffectsRoot);
        ndsAddBox(ndsMapRoot,0,-1,NDS_ISLAND_Z,108,2,108,0x63a648,true,false);
        const water = new THREE.Mesh(new THREE.BoxGeometry(220,2,220),new THREE.MeshLambertMaterial({color:0x347db2,transparent:true,opacity:.72}));
        water.position.set(0,-3,NDS_ISLAND_Z); ndsMapRoot.add(water);
        return ndsMapRoot;
    }

    function ndsBuildHouse(root,x,z,w=18,d=15,levels=2,color=0xd8c49a) {
        const oy=NDS_ISLAND_Z;
        ndsAddBox(root,x,1,z+oy,w,2,d,0xb8a27e,true,true);
        ndsAddBox(root,x,4,z+oy,w,6,1,color,true,true);
        ndsAddBox(root,x-w/2+.5,4,z+oy,w>12?1:1,6,d,color,true,true);
        ndsAddBox(root,x+w/2-.5,4,z+oy,1,6,d,color,true,true);
        ndsAddBox(root,x,4,z+oy-d/2+.5,w,6,1,color,true,true);
        ndsAddBox(root,x-5,4,z+oy+d/2-.5,5,6,1,color,true,true);
        ndsAddBox(root,x+5,4,z+oy+d/2-.5,5,6,1,color,true,true);
        ndsAddBox(root,x,7.4,z+oy,w+1,.8,d+1,0x8b4f35,true,true);
        if(levels>1){ ndsAddBox(root,x,10,z+oy,w,5.5,1,color,true,true); ndsAddBox(root,x-w/2+.5,10,z+oy,1,5.5,d,color,true,true); ndsAddBox(root,x+w/2-.5,10,z+oy,1,5.5,d,color,true,true); ndsAddBox(root,x,13,z+oy,w+1,.8,d+1,0x8b4f35,true,true); ndsAddStairs(root,x-w/2+3,2.3,z+oy+1,8,'z',0x9b7658); }
    }

    function ndsBuildTower(root,x,z,w=14,d=14,h=34,color=0x8caac0) {
        const baseZ=z+NDS_ISLAND_Z;
        ndsAddBox(root,x,h/2,baseZ,w,h,d,color,true,true,.92);
        for(let y=4;y<h;y+=5) ndsAddBox(root,x,y,baseZ+d/2+.03,w*.82,.25,.12,0x253846,false,true);
        ndsAddStairs(root,x-w/2+2,.5,baseZ-d/2+2,Math.max(8,Math.floor(h/2)),'z',0x777777);
    }

    function ndsBuildMapByName(name) {
        clearNDSMap(); const root=ndsMapBase(); const z0=NDS_ISLAND_Z;
        const roadMat=0x666666, concrete=0xa6a6a6, blue=0x5598b7, red=0xa7433c, tan=0xc7b58a, dark=0x55585c;
        const addRoad=(x,z,w,d)=>ndsAddBox(root,x,.08,z+z0,w,.16,d,roadMat,false,false);
        if(name==='Happy Home') {
            ndsBuildHouse(root,0,0,20,16,2,0xd8c59c); ndsAddBox(root,20,2,z0+8,8,1,3,0x2d65b3,true,true); ndsAddBox(root,22,4,z0+6,2,6,2,0xd44949,true,true);
            for(const x of [-18,-10,14]) ndsAddCylinder(root,x,3,z0-12,1.8,6,0x568a45,true,true);
        } else if(name==='Sky Tower') {
            ndsBuildTower(root,0,0,18,18,45,0x9ba8b2); ndsAddBox(root,0,47,z0,14,2,14,0x646a70,true,true);
        } else if(name==='Fort Indestructible') {
            ndsAddBox(root,0,3,z0,30,6,30,0x777d83,true,true); ndsAddBox(root,0,8,z0,20,4,20,0x8e9499,true,true); ndsBuildTower(root,22,-12,8,8,38,0x676d72);
            for(const x of [-10,0,10]) ndsAddBox(root,x,1.4,z0+22,7,2.8,4,0x556b45,true,true);
        } else if(name==='Glass Office') {
            ndsBuildTower(root,-10,0,14,18,38,0x4b8ba8); ndsBuildTower(root,10,0,14,18,42,0x4b8ba8); ndsAddBox(root,0,12,z0,8,3,8,0x688fa3,true,true);
        } else if(name==='Surf Central') {
            ndsAddBox(root,-8,3,z0,22,6,15,0xe8d8b7,true,true); ndsAddBox(root,18,5,z0-5,5,10,5,0xb36e4c,true,true); ndsAddBox(root,25,6,z0+12,24,12,18,0x6aa85a,true,true);
        } else if(name==='Heights School') {
            ndsAddBox(root,0,4,z0,42,8,24,0xc7b47a,true,true); ndsAddBox(root,0,9,z0,42,2,24,0x82583d,true,true); ndsAddStairs(root,-17,.5,z0+8,10,'x',0x929292);
        } else if(name==='Furious Station') {
            addRoad(0,0,70,22); ndsAddBox(root,-10,3,z0-10,28,6,14,0xd1c7b2,true,true); ndsAddBox(root,10,5,z0+4,36,1,18,0xd3473f,true,true); for(const x of [-18,0,18]) ndsAddBox(root,x,1.5,z0+16,7,3,4,0x3e5970,true,true);
        } else if(name==='Launch Land') {
            ndsBuildTower(root,-18,-5,9,9,28,0x70757a); ndsBuildTower(root,18,-7,8,8,22,0x777777); const rocket=ndsAddCylinder(root,2,12,z0,4,24,0xe7e7e7,true,true,18); ndsAddCylinder(root,2,25,z0,1.8,3,0xd94a3b,true,true,18); ndsAddBox(root,0,15,z0,24,1.2,2,0x888888,true,true);
        } else if(name==='Lucky Mart') {
            addRoad(0,12,80,25); ndsAddBox(root,0,4,z0-8,38,8,24,0xd7d1b8,true,true); ndsAddBox(root,0,8.5,z0-8,40,1,26,0x557f4e,true,true); for(const x of [-14,-7,0,7,14]) ndsAddBox(root,x,1,z0+10,3,2,5,0x434c55,true,true);
        } else if(name==='Manic Mansion') {
            ndsBuildHouse(root,0,-2,34,26,2,0xb9a2a8); ndsAddBox(root,0,17,z0-2,20,3,18,0x5e4d55,true,true); ndsAddBox(root,20,.3,z0+14,16,.6,10,0x3f8dc2,false,false);
        } else if(name==='Modest Headquarters') {
            ndsBuildTower(root,-12,0,14,16,34,blue); ndsBuildTower(root,12,0,14,16,38,blue); ndsAddBox(root,0,5,z0+15,34,10,18,0x6c8791,true,true); ndsAddCylinder(root,0,1.5,z0+30,5,3,0x9b9b9b,true,true);
        } else if(name==='Party Palace') {
            ndsAddBox(root,-15,3,z0,24,6,18,0xffd36a,true,true); ndsAddCylinder(root,18,10,z0,1.8,20,0x4a6fa5,true,true); const wheel=new THREE.Mesh(new THREE.TorusGeometry(12,.7,8,28),new THREE.MeshLambertMaterial({color:0xe85c7a}));wheel.position.set(10,14,z0-10);root.add(wheel);ndsBreakables.push(wheel); ndsAddBox(root,10,1,z0-10,3,2,3,0x777777,true,true);
        } else if(name==='Prison Panic') {
            ndsAddBox(root,0,4,z0,44,8,30,0x999999,true,true); ndsAddBox(root,0,9,z0,42,1,28,0x5d5d5d,true,true); for(const x of [-12,-4,4,12]) ndsAddBox(root,x,4,z0+12,1,7,5,0x444444,true,true); ndsBuildTower(root,22,-18,7,7,20,0x777777);
        } else if(name==='Rainbow Ride') {
            const wheel=new THREE.Mesh(new THREE.TorusGeometry(17,1,8,36),new THREE.MeshLambertMaterial({color:0xff607d})); wheel.position.set(0,20,z0); root.add(wheel); ndsBreakables.push(wheel); ndsAddBox(root,0,3,z0,5,6,5,0x777777,true,true); ndsAddBox(root,-24,3,z0+10,18,6,16,0xb9d2e0,true,true);
        } else if(name==='Rakish Refinery') {
            for(const x of [-20,0,20]) ndsAddCylinder(root,x,7,z0,7,14,0xa6a6a6,true,true,20); ndsBuildTower(root,0,-23,8,8,28,0x6c7478); ndsAddBox(root,0,12,z0,44,1,2,0x8e5d38,true,true);
        } else if(name==='Raving Raceway') {
            addRoad(0,0,85,15); addRoad(0,28,85,15); addRoad(-36,14,15,42); addRoad(36,14,15,42); ndsAddBox(root,0,4,z0-22,34,8,10,0xb8b8b8,true,true); for(const x of [-18,-6,6,18]) ndsAddBox(root,x,1.2,z0+6,5,2.4,3,0xd74949,true,true);
        } else if(name==='Safety Second') {
            ndsAddBox(root,-10,5,z0,26,10,20,0x9d9d9d,true,true); ndsBuildTower(root,22,0,5,5,28,0x777777); ndsAddBox(root,10,22,z0,28,1,2,0xf0c431,true,true); for(const z of [-18,16]) ndsAddCylinder(root,-24,2,z0+z,3,4,0x8f6a42,true,true);
        } else if(name==='Sunny Ranch') {
            ndsAddBox(root,0,5,z0,30,10,24,0xb74437,true,true); ndsAddBox(root,0,11,z0,34,3,28,0x5d3a2a,true,true); ndsAddCylinder(root,-22,8,z0,5,16,0xc2c2b0,true,true,20); ndsAddCylinder(root,22,8,z0,5,16,0xc2c2b0,true,true,20); ndsAddBox(root,0,1,z0+24,12,2,6,0xc9a65e,true,true);
        } else if(name==='Trailer Park') {
            for(const [x,z] of [[-20,-14],[0,-12],[20,-10],[-15,12],[12,15]]){ndsAddBox(root,x,2.7,z0+z,15,5.4,7,0xd7d7d7,true,true);ndsAddBox(root,x+5,5.6,z0+z,3,1,7,0x777777,true,true);} ndsBuildTower(root,28,22,5,5,22,0x858585);
        } else if(name==='Arch Park') {
            ndsAddBox(root,0,1,z0,70,.2,8,0xbcb6a5,false,false); ndsAddBox(root,0,7,z0-8,24,2,3,0xb0b0b0,true,true); ndsAddBox(root,-11,4,z0-8,2,8,3,0xb0b0b0,true,true); ndsAddBox(root,11,4,z0-8,2,8,3,0xb0b0b0,true,true); ndsAddBox(root,-22,3,z0+10,12,6,8,0xd86d42,true,true); ndsAddCylinder(root,20,4,z0+4,2,8,0x6e8d52,true,true);
        } else if(name==='Coastal Quickstop') {
            ndsAddBox(root,-16,3,z0,24,6,18,0xd6c8ad,true,true); ndsAddCylinder(root,22,10,z0-12,5,20,0xe2e2d7,true,true,16); ndsAddCylinder(root,22,21,z0-12,3,2,0xc24b43,true,true,16); ndsAddBox(root,0,.4,z0+28,42,.8,7,0x8c6c4d,true,true);
        } else if(name==='Devastation Station') {
            addRoad(0,10,85,10); ndsAddBox(root,-10,4,z0-8,36,8,16,0xc7bca6,true,true); ndsAddBox(root,10,2,z0+10,35,4,6,0x414d5e,true,true); ndsBuildTower(root,25,-18,5,5,24,0x797979); ndsAddCylinder(root,-28,8,z0-12,5,16,0x9da3a6,true,true,20);
        } else if(name==='Factory Frenzy') {
            ndsAddBox(root,-8,6,z0,38,12,28,0x777d83,true,true); ndsAddBox(root,-8,13,z0,40,2,30,0x53565a,true,true); ndsBuildTower(root,25,-15,7,7,28,0x62676b); ndsAddBox(root,18,20,z0-4,34,1.2,2,0xe1b438,true,true); ndsAddBox(root,0,.5,z0+32,50,1,10,0x876d55,true,true);
        }
        // spawn platform and central marker
        ndsAddBox(root,0,.3,z0+36,12,.6,12,0xc7c7c7,true,false);
    }

    function buildNaturalDisasterWorld() {
        ensureNDSProgress();
        gameScene.background = new THREE.Color(0x77b8e8);
        ndsStateStarted = false; ndsWeatherPower=0; ndsPreferredMapIndex=-1; ndsBalloonActive=false; ndsInfected=false;
        buildNDSLobby();
        ndsCurrentMapIndex = Math.floor(Math.random()*NDS_MAPS.length);
        ndsBuildMapByName(NDS_MAPS[ndsCurrentMapIndex]);
        ndsPhase='lobby'; ndsPhaseEndsAt=Date.now()+12000; ndsRoundId++;
        ndsCurrentDisasters=[]; ndsPlayerAlive=true; updateNDSHud();
        addChatMessageUI('Disaster Survival','Welcome! Survive the island disaster and earn a Survival.');
        addChatMessageUI('Disaster Survival',`Weather Machine boosts cost B ${NDS_WEATHER_BOOST_COST} and add one extra disaster to the next round.`);
        addChatMessageUI('Disaster Survival','Use Red Apple to heal, Green Balloon for extra lift, and Yellow Compass to pick the next map.');
        setTimeout(()=>{ if(isNaturalDisasterActive()) { sendNetworkMessage('NDS_STATE_REQUEST',{}); ndsStateSyncTimer=setTimeout(()=>{ if(isNaturalDisasterActive()&&!ndsStateStarted){ ndsStateStarted=true; broadcastNDSState(); } },700); } },250);
    }

    function cleanupNaturalDisasterState() {
        if (ndsStateSyncTimer) clearTimeout(ndsStateSyncTimer); ndsStateSyncTimer=null;
        if (ndsHudEl) { ndsHudEl.remove(); ndsHudEl=null; }
        if (ndsLobbyRoot && gameScene) gameScene.remove(ndsLobbyRoot); ndsLobbyRoot=null;
        clearNDSMap();
        ndsWeatherMachine=null; ndsWeatherMachineRing=null; ndsStateStarted=false; ndsBalloonActive=false; ndsInfected=false; stopNDSAmbience();
    }

    function ndsLobbySpawn() { return {x:0,y:2,z:NDS_LOBBY_Z+10}; }
    function ndsIslandSpawn() { return {x:0,y:2,z:NDS_ISLAND_Z+36}; }

    function broadcastNDSState() {
        if (!isNaturalDisasterActive()) return;
        sendNetworkMessage('NDS_ROUND_STATE',{roundId:ndsRoundId,phase:ndsPhase,phaseEndsAt:ndsPhaseEndsAt,mapIndex:ndsCurrentMapIndex,disasters:ndsCurrentDisasters,weatherPower:ndsWeatherPower});
    }

    function applyNDSState(payload) {
        if (!payload || !isNaturalDisasterActive()) return;
        ndsStateStarted=true;
        const incomingMap=Math.max(0,Math.min(NDS_MAPS.length-1,Number(payload.mapIndex)||0));
        if (incomingMap!==ndsCurrentMapIndex) { ndsCurrentMapIndex=incomingMap; ndsBuildMapByName(NDS_MAPS[ndsCurrentMapIndex]); }
        ndsRoundId=Number(payload.roundId)||ndsRoundId; ndsPhase=payload.phase||ndsPhase; ndsPhaseEndsAt=Number(payload.phaseEndsAt)||ndsPhaseEndsAt;
        ndsCurrentDisasters=Array.isArray(payload.disasters)?payload.disasters.filter(x=>NDS_DISASTERS.includes(x)):[];
        ndsWeatherPower=Math.max(0,Math.min(NDS_MAX_WEATHER_POWER,Number(payload.weatherPower)||0));
        if (ndsPhase==='disaster') ndsPrepareDisasterEffects();
        updateNDSHud();
    }

    function ndsSelectDisasters() {
        const count=Math.min(1+ndsWeatherPower,4); const pool=[...NDS_DISASTERS]; const out=[];
        while(out.length<count && pool.length){ const i=Math.floor(Math.random()*pool.length); out.push(pool.splice(i,1)[0]); }
        return out;
    }

    function ndsAdvancePhase() {
        const now=Date.now();
        if (ndsPhase==='lobby') {
            if (ndsPreferredMapIndex>=0) { ndsCurrentMapIndex=ndsPreferredMapIndex; ndsPreferredMapIndex=-1; }
            else ndsCurrentMapIndex=Math.floor(Math.random()*NDS_MAPS.length);
            ndsBuildMapByName(NDS_MAPS[ndsCurrentMapIndex]); ndsCurrentDisasters=[];
            ndsPhase='prep'; ndsPhaseEndsAt=now+12000; ndsPlayerAlive=true; ndsRoundStartedAlive=true; ndsInfected=false;
            playerPos=ndsIslandSpawn(); playerVelocityY=0; updateHealthUI(100); activateLocalSpawnShield(3500,true);
            addChatMessageUI('Disaster Survival',`Map: ${NDS_MAPS[ndsCurrentMapIndex]} — get ready!`);
        } else if (ndsPhase==='prep') {
            ndsCurrentDisasters=ndsSelectDisasters(); ndsWeatherPower=0;
            ndsPhase='disaster'; ndsPhaseEndsAt=now+65000; ndsPlayerAlive=true; ndsRoundStartedAlive=true;
            ndsPrepareDisasterEffects();
            addChatMessageUI('WARNING',ndsCurrentDisasters.join(' + '));
        } else if (ndsPhase==='disaster') {
            ndsPhase='results'; ndsPhaseEndsAt=now+9000;
            if (ndsPlayerAlive && ndsRoundStartedAlive) {
                currentUser.ndsSurvivals=(Number(currentUser.ndsSurvivals)||0)+1; saveToStorage();
                addChatMessageUI('Survivors',`${currentUser.username} survived! Total survivals: ${currentUser.ndsSurvivals}`);
            } else addChatMessageUI('Survivors','You did not survive this round.');
            playerPos=ndsLobbySpawn(); playerVelocityY=0; updateHealthUI(100); ndsInfected=false;
            ndsClearEffectsOnly();
        } else {
            ndsPhase='lobby'; ndsPhaseEndsAt=now+12000; ndsCurrentDisasters=[]; ndsPlayerAlive=true; ndsRoundStartedAlive=false; ndsRoundId++;
            playerPos=ndsLobbySpawn(); playerVelocityY=0; updateHealthUI(100);
        }
        broadcastNDSState(); updateNDSHud();
    }

    function ndsClearEffectsOnly() {
        if (ndsEffectsRoot && gameScene) gameScene.remove(ndsEffectsRoot);
        ndsEffectsRoot=new THREE.Group(); if(gameScene) gameScene.add(ndsEffectsRoot);
        ndsWeatherParticles=[]; ndsMeteors=[]; ndsSnowChunks=[]; ndsFireSpots=[]; ndsTornadoDebris=[]; ndsVolcanoSmoke=[]; ndsTsunami=null; ndsTornado=null; ndsFloodWater=null; ndsVolcano=null; ndsMountain=null;
        stopNDSAmbience();
        if (ndsMapRoot) ndsMapRoot.position.set(0,0,0);
    }

    function ndsMakeParticle(color,size=0.25) {
        const m=new THREE.Mesh(new THREE.BoxGeometry(size,size*2,size),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.85}));
        ndsEffectsRoot.add(m); return m;
    }

    function ndsNoiseBurst(duration=.35, volume=.06, filterFreq=1200) {
        initAudioContext(); if(!audioCtx) return;
        try {
            const now=audioCtx.currentTime, n=Math.max(1,Math.floor(audioCtx.sampleRate*duration));
            const b=audioCtx.createBuffer(1,n,audioCtx.sampleRate), data=b.getChannelData(0);
            for(let i=0;i<n;i++) data[i]=(Math.random()*2-1)*(1-i/n);
            const src=audioCtx.createBufferSource(), filter=audioCtx.createBiquadFilter(), gain=audioCtx.createGain();
            src.buffer=b; filter.type='lowpass'; filter.frequency.setValueAtTime(filterFreq,now);
            gain.gain.setValueAtTime(volume,now); gain.gain.exponentialRampToValueAtTime(.001,now+duration);
            src.connect(filter); filter.connect(gain); gain.connect(audioCtx.destination); src.start(now); src.stop(now+duration);
        } catch(_) {}
    }

    function ndsTone(freq,duration=.3,volume=.05,wave='sine',endFreq=null,delay=0) {
        initAudioContext(); if(!audioCtx) return;
        try {
            const now=audioCtx.currentTime+delay, osc=audioCtx.createOscillator(), gain=audioCtx.createGain();
            osc.type=wave; osc.frequency.setValueAtTime(freq,now); if(endFreq)osc.frequency.exponentialRampToValueAtTime(Math.max(1,endFreq),now+duration);
            gain.gain.setValueAtTime(volume,now); gain.gain.exponentialRampToValueAtTime(.001,now+duration);
            osc.connect(gain); gain.connect(audioCtx.destination); osc.start(now); osc.stop(now+duration);
        } catch(_) {}
    }

    function playNDSSound(kind) {
        if(!isNaturalDisasterActive()) return;
        if(kind==='warning'){ndsTone(620,.18,.055,'square');ndsTone(420,.18,.055,'square',null,.2);ndsTone(620,.22,.05,'square',null,.4);}
        else if(kind==='wind'){ndsNoiseBurst(.55,.025,650);ndsTone(95,.5,.018,'sine',70);}
        else if(kind==='avalanche'){ndsNoiseBurst(.6,.07,520);ndsTone(70,.55,.055,'triangle',38);}
        else if(kind==='meteor'){ndsTone(920,.45,.04,'sine',130);}
        else if(kind==='impact'){playExplosionSound();}
        else if(kind==='tornado'){ndsNoiseBurst(.65,.045,850);ndsTone(82,.6,.028,'sawtooth',58);}
        else if(kind==='volcano'){ndsNoiseBurst(.7,.06,420);ndsTone(58,.65,.06,'sine',34);}
        else if(kind==='thunder'){ndsNoiseBurst(.6,.12,700);ndsTone(75,.5,.08,'sine',32);}
        else if(kind==='water'){ndsNoiseBurst(.6,.035,1000);ndsTone(120,.55,.018,'sine',90);}
        else if(kind==='fire'){ndsNoiseBurst(.3,.025,1800);ndsTone(150,.18,.015,'triangle',95);}
        else if(kind==='rain'){ndsNoiseBurst(.55,.025,2200);}
    }

    function stopNDSAmbience(){ if(ndsSoundLoopTimer)clearInterval(ndsSoundLoopTimer); ndsSoundLoopTimer=null; }
    function startNDSAmbience(){
        stopNDSAmbience();
        const pulse=()=>{
            if(!isNaturalDisasterActive()||ndsPhase!=='disaster')return;
            if(ndsCurrentDisasters.includes('Tornado'))playNDSSound('tornado');
            else if(ndsCurrentDisasters.includes('Avalanche'))playNDSSound('avalanche');
            else if(ndsCurrentDisasters.includes('Volcanic Eruption')||ndsCurrentDisasters.includes('Meteor Shower'))playNDSSound('volcano');
            else if(ndsCurrentDisasters.includes('Tsunami')||ndsCurrentDisasters.includes('Flash Flood'))playNDSSound('water');
            else if(ndsCurrentDisasters.includes('Fire'))playNDSSound('fire');
            else if(ndsCurrentDisasters.some(x=>['Acid Rain','Blizzard','Sandstorm','Thunderstorm'].includes(x)))playNDSSound('wind');
        };
        pulse(); ndsSoundLoopTimer=setInterval(pulse,1250);
    }

    function ndsCreateAvalancheMountain(){
        if(ndsMountain)return ndsMountain;
        const g=new THREE.Group();
        const rock=new THREE.Mesh(new THREE.ConeGeometry(25,38,18),new THREE.MeshLambertMaterial({color:0x69737c}));rock.position.y=18;g.add(rock);
        const snow=new THREE.Mesh(new THREE.ConeGeometry(15,17,18),new THREE.MeshLambertMaterial({color:0xf4f7fb}));snow.position.y=32;g.add(snow);
        const ridge=new THREE.Mesh(new THREE.ConeGeometry(8,12,12),new THREE.MeshLambertMaterial({color:0xdde7ef}));ridge.position.set(9,27,2);ridge.rotation.z=.22;g.add(ridge);
        g.position.set(-58,0,NDS_ISLAND_Z);ndsEffectsRoot.add(g);ndsMountain=g;return g;
    }

    function ndsCreateVolcano(){
        if(ndsVolcano)return ndsVolcano;
        const g=new THREE.Group();
        const body=new THREE.Mesh(new THREE.ConeGeometry(18,29,24),new THREE.MeshLambertMaterial({color:0x5b463d}));body.position.y=14;g.add(body);
        const lava=new THREE.Mesh(new THREE.CylinderGeometry(5.5,6.2,1.5,22),new THREE.MeshBasicMaterial({color:0xff4d18}));lava.position.y=28.3;g.add(lava);
        const rim=new THREE.Mesh(new THREE.TorusGeometry(6,.8,8,24),new THREE.MeshLambertMaterial({color:0x352c29}));rim.rotation.x=Math.PI/2;rim.position.y=29;g.add(rim);
        g.position.set(58,0,NDS_ISLAND_Z-20);ndsEffectsRoot.add(g);ndsVolcano=g;
        for(let i=0;i<10;i++){
            const sm=new THREE.Mesh(new THREE.SphereGeometry(1.2+Math.random()*1.4,8,6),new THREE.MeshBasicMaterial({color:0x55585a,transparent:true,opacity:.34}));
            sm.position.set((Math.random()-.5)*5,30+Math.random()*12,(Math.random()-.5)*5);g.add(sm);ndsVolcanoSmoke.push({mesh:sm,baseY:sm.position.y,phase:Math.random()*6.28});
        }
        return g;
    }

    function ndsCreateAnimatedTornado(){
        if(ndsTornado)return ndsTornado;
        const g=new THREE.Group();
        const funnel=new THREE.Mesh(new THREE.CylinderGeometry(8.5,1.1,24,20,1,true),new THREE.MeshBasicMaterial({color:0x9da7ad,transparent:true,opacity:.17,side:THREE.DoubleSide,depthWrite:false}));funnel.position.y=12;g.add(funnel);
        for(let i=0;i<12;i++){
            const radius=1.5+i*.58;
            const ring=new THREE.Mesh(new THREE.TorusGeometry(radius,.24,6,26),new THREE.MeshBasicMaterial({color:i%2?0xc7d0d4:0x8d989e,transparent:true,opacity:.52}));
            ring.position.y=1+i*1.9;ring.rotation.x=Math.PI/2;ring.userData.ndsSpin=(i%2?1:-1)*(1.3+i*.08);g.add(ring);
        }
        for(let i=0;i<38;i++){
            const d=new THREE.Mesh(new THREE.BoxGeometry(.28,.28,.28),new THREE.MeshBasicMaterial({color:i%3===0?0xd0d0d0:0x6f7478,transparent:true,opacity:.8}));
            const y=1+Math.random()*22, r=1.5+(y/22)*7*Math.random();
            d.userData.ndsAngle=Math.random()*Math.PI*2;d.userData.ndsRadius=r;d.userData.ndsY=y;d.userData.ndsSpeed=1.8+Math.random()*3.2;g.add(d);ndsTornadoDebris.push(d);
        }
        g.position.set(-25,1,NDS_ISLAND_Z);ndsEffectsRoot.add(g);ndsTornado=g;return g;
    }

    function ndsPrepareDisasterEffects() {
        ndsClearEffectsOnly();
        for (const d of ndsCurrentDisasters) {
            if (d==='Acid Rain' || d==='Blizzard' || d==='Sandstorm') {
                const color=d==='Acid Rain'?0x78ff55:d==='Blizzard'?0xffffff:0xd8b56d;
                for(let i=0;i<70;i++){const p=ndsMakeParticle(color,d==='Sandstorm'?0.45:0.22);p.position.set((Math.random()-.5)*100,5+Math.random()*45,NDS_ISLAND_Z+(Math.random()-.5)*100);ndsWeatherParticles.push({mesh:p,kind:d,speed:7+Math.random()*9});}
            } else if (d==='Flash Flood') {
                ndsFloodWater=new THREE.Mesh(new THREE.BoxGeometry(120,3,120),new THREE.MeshLambertMaterial({color:0x2d7eb6,transparent:true,opacity:.72})); ndsFloodWater.position.set(0,-5,NDS_ISLAND_Z);ndsEffectsRoot.add(ndsFloodWater);
            } else if (d==='Tsunami') {
                ndsTsunami=new THREE.Mesh(new THREE.BoxGeometry(7,22,120),new THREE.MeshLambertMaterial({color:0x328cc1,transparent:true,opacity:.82}));ndsTsunami.position.set(-70,9,NDS_ISLAND_Z);ndsEffectsRoot.add(ndsTsunami);ndsTsunami.userData.dir=1;
            } else if (d==='Avalanche') {
                ndsCreateAvalancheMountain();
            } else if (d==='Tornado') {
                ndsCreateAnimatedTornado();
            } else if (d==='Meteor Shower' || d==='Volcanic Eruption') {
                ndsCreateVolcano();
            } else if (d==='Fire') {
                const starter=ndsBreakables.length?ndsBreakables[Math.floor(Math.random()*ndsBreakables.length)]:null; if(starter) ndsIgniteAt(starter.position.clone());
            }
        }
        const now=Date.now(); ndsNextLightningAt=now+1200; ndsNextMeteorAt=now+800; ndsNextAvalancheAt=now+900; ndsNextVolcanoAt=now+1000; ndsNextFireSpreadAt=now+1800; ndsNextVirusSpreadAt=now+1800;
        if (ndsCurrentDisasters.includes('Deadly Virus')) { ndsInfected = Math.random()<0.35 || Object.keys(remotePlayers).length===0; if(ndsInfected) sendNetworkMessage('NDS_INFECT',{infected:true}); }
        playNDSSound('warning');
        startNDSAmbience();
    }

    function ndsIgniteAt(pos) {
        const flame=new THREE.Mesh(new THREE.ConeGeometry(.8,2.4,8),new THREE.MeshBasicMaterial({color:0xff6a00,transparent:true,opacity:.9})); flame.position.copy(pos); flame.position.y+=1.2; ndsEffectsRoot.add(flame); ndsFireSpots.push(flame);
    }

    function ndsIsUnderCover() {
        const head=playerPos.y+2.8;
        for(const c of ndsMapColliders) if(playerPos.x>c.min.x&&playerPos.x<c.max.x&&playerPos.z>c.min.z&&playerPos.z<c.max.z&&c.min.y>head+.25&&c.min.y<head+20) return true;
        return false;
    }

    function ndsDamage(amount, reason, cooldown=650) {
        if (!ndsPlayerAlive || ndsPhase!=='disaster') return;
        const now=Date.now(); if(now<ndsNextDamageAt) return; ndsNextDamageAt=now+cooldown;
        updateHealthUI(playerHealth-amount);
        if(playerHealth<=0){ ndsPlayerAlive=false; ndsInfected=false; addChatMessageUI('Disaster Survival',`You were eliminated by ${reason}.`); playerPos=ndsLobbySpawn(); playerVelocityY=0; setTimeout(()=>{if(isNaturalDisasterActive())updateHealthUI(100);},100); }
    }

    function ndsSpawnMeteor(volcanic=false) {
        let x=(Math.random()-.5)*85, z=NDS_ISLAND_Z+(Math.random()-.5)*85, y=45+Math.random()*20;
        let vx=(Math.random()-.5)*3, vz=(Math.random()-.5)*3;
        if(volcanic && ndsVolcano){x=ndsVolcano.position.x+(Math.random()-.5)*5;z=ndsVolcano.position.z+(Math.random()-.5)*5;y=32+Math.random()*7;vx=-9-Math.random()*9;vz=(Math.random()-.5)*9;}
        const m=new THREE.Mesh(new THREE.SphereGeometry(volcanic?1.2:1.6,8,8),new THREE.MeshBasicMaterial({color:volcanic?0xff5b18:0x55372d}));
        const glow=new THREE.PointLight(volcanic?0xff5511:0xffaa55,1.2,18);m.add(glow);
        const tail=new THREE.Mesh(new THREE.ConeGeometry(.45,3.5,8),new THREE.MeshBasicMaterial({color:volcanic?0xff9b30:0xffc67a,transparent:true,opacity:.55}));tail.position.y=2;tail.rotation.z=Math.PI; m.add(tail);
        m.position.set(x,y,z);ndsEffectsRoot.add(m);ndsMeteors.push({mesh:m,vy:volcanic?8+Math.random()*5:-14-Math.random()*8,vx,vz,volcanic});
        if(!volcanic)playNDSSound('meteor');
    }

    function ndsSpawnAvalancheChunk() {
        ndsCreateAvalancheMountain();
        const m=new THREE.Mesh(new THREE.BoxGeometry(2+Math.random()*2,2+Math.random()*2,2+Math.random()*2),new THREE.MeshLambertMaterial({color:0xf1f5f7}));m.position.set(-50,22+Math.random()*12,NDS_ISLAND_Z-30+Math.random()*60);m.rotation.set(Math.random(),Math.random(),Math.random());ndsEffectsRoot.add(m);ndsSnowChunks.push({mesh:m,vx:14+Math.random()*8,vy:-4,spin:(Math.random()-.5)*5});
        if(performance.now()-ndsLastImpactSoundAt>700){ndsLastImpactSoundAt=performance.now();playNDSSound('avalanche');}
    }

    function ndsLightningStrike() {
        const x=(Math.random()-.5)*90,z=NDS_ISLAND_Z+(Math.random()-.5)*90;
        const bolt=new THREE.Mesh(new THREE.CylinderGeometry(.18,.18,42,6),new THREE.MeshBasicMaterial({color:0xf8f7c5}));bolt.position.set(x,21,z);ndsEffectsRoot.add(bolt);setTimeout(()=>{if(bolt.parent)bolt.parent.remove(bolt);},120);
        playNDSSound('thunder'); if(Math.hypot(playerPos.x-x,playerPos.z-z)<4.5) ndsDamage(55,'lightning',900);
    }

    function ndsUpdateParticles(dt) {
        for(const p of ndsWeatherParticles){ if(!p.mesh)continue; if(p.kind==='Sandstorm'){p.mesh.position.x+=dt*p.speed*2;p.mesh.position.y+=(Math.random()-.5)*dt*2;}else{p.mesh.position.y-=dt*p.speed;if(p.kind==='Blizzard')p.mesh.position.x+=Math.sin(performance.now()/300+p.mesh.position.z)*dt*3;} if(p.mesh.position.y<-1||Math.abs(p.mesh.position.x)>60){p.mesh.position.set((Math.random()-.5)*100,35+Math.random()*25,NDS_ISLAND_Z+(Math.random()-.5)*100);} }
    }

    function ndsUpdateDisasters(nowMs,dt) {
        if(ndsPhase!=='disaster'||!ndsPlayerAlive)return;
        const now=Date.now(); ndsUpdateParticles(dt);
        const exposed=!ndsIsUnderCover();
        if(ndsCurrentDisasters.includes('Acid Rain')&&exposed) ndsDamage(7,'acid rain',700);
        if(ndsCurrentDisasters.includes('Blizzard')&&exposed) ndsDamage(4,'blizzard exposure',900);
        if(ndsCurrentDisasters.includes('Sandstorm')&&exposed) ndsDamage(5,'sandstorm',850);
        if(ndsCurrentDisasters.includes('Thunderstorm')&&now>=ndsNextLightningAt){ndsNextLightningAt=now+900+Math.random()*1400;ndsLightningStrike();}
        if(ndsCurrentDisasters.includes('Meteor Shower')&&now>=ndsNextMeteorAt){ndsNextMeteorAt=now+500+Math.random()*700;ndsSpawnMeteor(false);}
        if(ndsCurrentDisasters.includes('Avalanche')&&now>=ndsNextAvalancheAt){ndsNextAvalancheAt=now+500+Math.random()*600;ndsSpawnAvalancheChunk();}
        if(ndsCurrentDisasters.includes('Volcanic Eruption')&&now>=ndsNextVolcanoAt){ndsNextVolcanoAt=now+650+Math.random()*800;ndsSpawnMeteor(true);}
        if(ndsCurrentDisasters.includes('Fire')){
            if(now>=ndsNextFireSpreadAt){ndsNextFireSpreadAt=now+1800;const target=ndsBreakables[Math.floor(Math.random()*Math.max(1,ndsBreakables.length))];if(target)ndsIgniteAt(target.position.clone());}
            for(const f of ndsFireSpots) if(f&&Math.hypot(playerPos.x-f.position.x,playerPos.z-f.position.z)<3.5&&Math.abs(playerPos.y-f.position.y)<5) ndsDamage(8,'fire',700);
        }
        if(ndsCurrentDisasters.includes('Flash Flood')&&ndsFloodWater){const t=1-Math.max(0,(ndsPhaseEndsAt-now)/65000);ndsFloodWater.position.y=-5+t*15;if(playerPos.y<ndsFloodWater.position.y+2)ndsDamage(12,'flash flood',650);}
        if(ndsCurrentDisasters.includes('Tsunami')&&ndsTsunami){ndsTsunami.position.x+=dt*14*ndsTsunami.userData.dir;if(ndsTsunami.position.x>70){ndsTsunami.position.x=-70;}if(Math.abs(playerPos.x-ndsTsunami.position.x)<4&&playerPos.y<18)ndsDamage(30,'tsunami',1100);}
        if(ndsCurrentDisasters.includes('Tornado')&&ndsTornado){
            const t=nowMs/1000;ndsTornado.position.x=Math.sin(t*.32)*32;ndsTornado.position.z=NDS_ISLAND_Z+Math.cos(t*.27)*32;ndsTornado.rotation.y+=dt*1.9;
            ndsTornado.children.forEach(ch=>{if(ch.userData&&ch.userData.ndsSpin)ch.rotation.z+=dt*ch.userData.ndsSpin;});
            ndsTornadoDebris.forEach(d=>{d.userData.ndsAngle+=dt*d.userData.ndsSpeed;const r=d.userData.ndsRadius,y=d.userData.ndsY;d.position.set(Math.cos(d.userData.ndsAngle)*r,y+Math.sin(t*3+d.userData.ndsAngle)*.5,Math.sin(d.userData.ndsAngle)*r);d.rotation.x+=dt*4;d.rotation.y+=dt*3;});
            const dx=ndsTornado.position.x-playerPos.x,dz=ndsTornado.position.z-playerPos.z,dist=Math.hypot(dx,dz);if(dist<15){playerPos.x+=dx/Math.max(1,dist)*dt*8;playerPos.z+=dz/Math.max(1,dist)*dt*8;playerVelocityY+=dt*.08;if(dist<6)ndsDamage(10,'tornado',700);}
        }
        if(ndsVolcano){const t=nowMs/1000;ndsVolcanoSmoke.forEach((o,i)=>{if(!o.mesh)return;o.mesh.position.y=o.baseY+((t*.9+i*.21)%9);o.mesh.position.x=Math.sin(t*.7+o.phase)*2.2;o.mesh.position.z=Math.cos(t*.55+o.phase)*1.8;o.mesh.scale.setScalar(1+((t*.35+i*.11)%1)*.8);});}
        if(ndsCurrentDisasters.includes('Earthquake')){ if(ndsMapRoot){ndsMapRoot.position.x=Math.sin(nowMs*.045)*.22;ndsMapRoot.position.z=Math.cos(nowMs*.05)*.22;} if(!isGrounded&&Math.random()<.01)ndsDamage(4,'earthquake debris',900); }
        if(ndsCurrentDisasters.includes('Deadly Virus')){
            if(ndsInfected) ndsDamage(3,'deadly virus',1200);
            if(now>=ndsNextVirusSpreadAt){ndsNextVirusSpreadAt=now+1100;for(const id in remotePlayers){const p=remotePlayers[id];if(!p||!p.mesh)continue;const dist=Math.hypot(p.mesh.position.x-playerPos.x,p.mesh.position.z-playerPos.z);if(dist<5&&p.ndsInfected&&!ndsInfected){ndsInfected=true;sendNetworkMessage('NDS_INFECT',{infected:true});addChatMessageUI('WARNING','You caught the Deadly Virus! Keep away from other players.');break;}}}
        }
        for(let i=ndsMeteors.length-1;i>=0;i--){const o=ndsMeteors[i];o.mesh.position.x+=o.vx*dt;o.mesh.position.z+=o.vz*dt;o.mesh.position.y+=o.vy*dt;o.vy-=18*dt;o.mesh.rotation.x+=dt*5;o.mesh.rotation.z+=dt*3;if(o.mesh.position.y<=0){const d=Math.hypot(playerPos.x-o.mesh.position.x,playerPos.z-o.mesh.position.z);if(d<6)ndsDamage(o.volcanic?26:34,o.volcanic?'volcanic rock':'meteor',900);if(performance.now()-ndsLastImpactSoundAt>180){ndsLastImpactSoundAt=performance.now();playNDSSound('impact');}const flash=new THREE.Mesh(new THREE.SphereGeometry(2.5,10,8),new THREE.MeshBasicMaterial({color:o.volcanic?0xff5b18:0xffb45f,transparent:true,opacity:.65}));flash.position.copy(o.mesh.position);flash.position.y=.5;ndsEffectsRoot.add(flash);setTimeout(()=>{if(flash.parent)flash.parent.remove(flash);},180);if(o.mesh.parent)o.mesh.parent.remove(o.mesh);ndsMeteors.splice(i,1);}}
        for(let i=ndsSnowChunks.length-1;i>=0;i--){const o=ndsSnowChunks[i];o.mesh.position.x+=o.vx*dt;o.mesh.position.y+=o.vy*dt;o.vy-=7*dt;o.mesh.rotation.x+=dt*(o.spin||2);o.mesh.rotation.z+=dt*1.7;if(Math.hypot(playerPos.x-o.mesh.position.x,playerPos.z-o.mesh.position.z)<3&&Math.abs(playerPos.y-o.mesh.position.y)<4)ndsDamage(20,'avalanche',900);if(o.mesh.position.x>60||o.mesh.position.y<-3){if(o.mesh.parent)o.mesh.parent.remove(o.mesh);ndsSnowChunks.splice(i,1);}}
    }

    function updateNaturalDisasterGame(nowMs,dt) {
        if(!isNaturalDisasterActive())return;
        if(ndsWeatherMachineRing){ndsWeatherMachineRing.rotation.z+=dt*1.8;const s=1+Math.sin(nowMs/300)*.06;ndsWeatherMachineRing.scale.set(s,s,s);}
        if(ndsBalloonActive&&playerVelocityY<0) playerVelocityY+=0.006;
        if(Date.now()>=ndsPhaseEndsAt) ndsAdvancePhase();
        ndsUpdateDisasters(nowMs,dt); updateNDSHud();
    }

    function interactNaturalDisasterWorld() {
        if(!isNaturalDisasterActive())return false;
        if(ndsPhase==='lobby'||ndsPhase==='results'){
            const d=Math.hypot(playerPos.x-7,playerPos.z-(NDS_LOBBY_Z+5));
            if(d<6){
                ensureNDSProgress();
                if(ndsWeatherPower>=NDS_MAX_WEATHER_POWER){addChatMessageUI('Weather Machine','Maximum power reached for the next round.');return true;}
                if((Number(currentUser.balance)||0)<NDS_WEATHER_BOOST_COST){addChatMessageUI('Weather Machine',`You need B ${NDS_WEATHER_BOOST_COST} Dohbux to boost it.`);return true;}
                currentUser.balance-=NDS_WEATHER_BOOST_COST; ndsWeatherPower++; saveToStorage(); renderHeader();
                addChatMessageUI('Weather Machine',`BOOSTED! Next round gets +${ndsWeatherPower} extra disaster${ndsWeatherPower===1?'':'s'}.`); sendNetworkMessage('NDS_WEATHER_BOOST',{weatherPower:ndsWeatherPower}); broadcastNDSState(); updateNDSHud(); return true;
            }
        }
        return false;
    }

    function useNDSItem(type) {
        if(type==='nds_apple'){
            const now=Date.now();if(now<ndsAppleCooldownUntil)return;ndsAppleCooldownUntil=now+4000;updateHealthUI(Math.min(100,playerHealth+25));addChatMessageUI('Red Apple','Health restored.');
        } else if(type==='nds_balloon'){
            ndsBalloonActive=!ndsBalloonActive;addChatMessageUI('Green Balloon',ndsBalloonActive?'Balloon equipped: higher jumps and slower falls.':'Balloon put away.');
        } else if(type==='nds_compass'){
            if(ndsPhase!=='lobby'&&ndsPhase!=='results'){addChatMessageUI('Yellow Compass','Choose the next map while you are in the lobby.');return;}
            ndsPreferredMapIndex=(ndsPreferredMapIndex+1)%NDS_MAPS.length;ndsCurrentMapIndex=ndsPreferredMapIndex;ndsBuildMapByName(NDS_MAPS[ndsCurrentMapIndex]);addChatMessageUI('Yellow Compass',`Next map selected: ${NDS_MAPS[ndsPreferredMapIndex]}`);broadcastNDSState();updateNDSHud();
        }
    }


    function launchGame(gameTitle, gameId = null) {
        activeGameRecord = (gameId !== null ? gamesDatabase.find(g => String(g.id) === String(gameId)) : null) || gamesDatabase.find(g => g.title === gameTitle) || null;
        initAudioContext();
        document.getElementById('loading-game-title').innerText = gameTitle;
        document.getElementById('loading-status-text').innerText = "Connecting to Dohblox Place Server...";
        document.getElementById('game-loading-overlay').classList.remove('hidden');

        loadingStepTimeouts.push(setTimeout(() => {
            document.getElementById('loading-status-text').innerText = "Loading 3D Map Geometry...";
        }, 800));

        loadingStepTimeouts.push(setTimeout(() => {
            document.getElementById('loading-status-text').innerText = "Joining Game Session...";
        }, 1600));

        gameLaunchTimeout = setTimeout(() => {
            document.getElementById('game-loading-overlay').classList.add('hidden');
            open3DGameViewport(gameTitle);
        }, 2200);
    }

    function abortGameLaunch() {
        if (gameLaunchTimeout) clearTimeout(gameLaunchTimeout);
        loadingStepTimeouts.forEach(t => clearTimeout(t));
        document.getElementById('game-loading-overlay').classList.add('hidden');
    }

    function open3DGameViewport(gameTitle) {
        activeGameTitle = gameTitle;
        const chatBox = document.getElementById('chat-messages');
        if (chatBox) chatBox.innerHTML = '';
        document.getElementById('active-game-title').innerText = gameTitle;
        document.getElementById('r2009-menu-game-name').innerText = gameTitle;
        document.getElementById('game-viewport-modal').classList.remove('hidden');

        setup3DSceneWorld(gameTitle);
        setupDefaultHotbarForGame(gameTitle);
        updateGameLeaderboard();
        updateESCMenuPlayerList();

        joinCloudGameRoom(gameTitle).then(() => {
            sendNetworkMessage('JOIN_GAME', {
                colors: currentUser.colors,
                equipped: currentUser.equipped,
                position: playerPos,
                yaw: cameraYaw,
                pizzaOrder: getLocalPizzaOrderNetworkState(),
                pizzaVehicle: isPizzaPlaceActive() ? (pizzaInBike ? 'bike' : pizzaInCar ? 'car' : null) : null,
                pizzaVehicleYaw: pizzaInBike ? pizzaBikeYaw : pizzaInCar ? pizzaCarYaw : null,
                ndsInfected: isNaturalDisasterActive() ? ndsInfected : false
            });
        });

        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => {
            if (activeGameTitle) {
                sendNetworkMessage('HEARTBEAT', {
                    colors: currentUser.colors,
                    equipped: currentUser.equipped,
                    position: playerPos,
                    yaw: cameraYaw,
                    pizzaOrder: getLocalPizzaOrderNetworkState(),
                    pizzaVehicle: isPizzaPlaceActive() ? (pizzaInBike ? 'bike' : pizzaInCar ? 'car' : null) : null,
                    pizzaVehicleYaw: pizzaInBike ? pizzaBikeYaw : pizzaInCar ? pizzaCarYaw : null,
                    ndsInfected: isNaturalDisasterActive() ? ndsInfected : false
                });
                checkRemotePlayerTimeouts();
            }
        }, 1000);
    }

    function setupDefaultHotbarForGame(title) {
        inGameHotbar = Array(10).fill(null);
        const equippedBoombox = currentUser.equipped.find(e => e.type === 'boombox');

        if (title.includes("Crossroads") || title.includes("Dohblox HQ")) {
            inGameHotbar[0] = { name: "Sword", type: "sword" };
            inGameHotbar[1] = { name: "Rocket", type: "rocket_launcher" };
            inGameHotbar[2] = { name: "Bomb", type: "timebomb" };
            inGameHotbar[3] = { name: "Slingshot", type: "slingshot" };
            inGameHotbar[4] = { name: "Trowel", type: "trowel" };
            if (equippedBoombox) inGameHotbar[5] = equippedBoombox;
        } else if (title.includes("Natural Disaster")) {
            inGameHotbar[0] = { name: "Red Apple", type: "nds_apple" };
            inGameHotbar[1] = { name: "Green Balloon", type: "nds_balloon" };
            inGameHotbar[2] = { name: "Yellow Compass", type: "nds_compass" };
        } else if (title.includes("Pizza Place")) {
            inGameHotbar[0] = { name: "Interact", type: "job_tool" };
            if (equippedBoombox) inGameHotbar[1] = equippedBoombox;
        } else if (activeGameRecord && activeGameRecord.type === 'studio_published') {
            const sg=(activeGameRecord.studioWorld&&activeGameRecord.studioWorld.starterGear)||'none';
            if(sg==='sword') inGameHotbar[0]={name:'Classic Sword',type:'sword'};
            if(sg==='classic'){inGameHotbar[0]={name:'Sword',type:'sword'};inGameHotbar[1]={name:'Rocket',type:'rocket_launcher'};inGameHotbar[2]={name:'Bomb',type:'timebomb'};inGameHotbar[3]={name:'Slingshot',type:'slingshot'};inGameHotbar[4]={name:'Trowel',type:'trowel'};}
            if(equippedBoombox && !inGameHotbar.some(x=>x&&x.type==='boombox')) inGameHotbar[sg==='classic'?5:1]=equippedBoombox;
        } else {
            const equippedWeapon = currentUser.equipped.find(e => e.category === 'gear' || e.type === 'sword');
            inGameHotbar[0] = equippedWeapon || { name: "Classic Sword", type: "sword" };
            if (equippedBoombox && inGameHotbar[0] !== equippedBoombox) inGameHotbar[1] = equippedBoombox;
        }

        updateHotbarUI();
        selectHotbarSlot(0);
        if (title.includes("Crossroads") || title.includes("Dohblox HQ")) startCrossroadsCooldownUI();
        const touchBtn = document.getElementById('btn-touch-attack');
        if (touchBtn) touchBtn.innerText = (title.includes('Pizza Place') || title.includes('Natural Disaster')) ? 'USE / INTERACT' : 'USE';
    }

    function setup3DSceneWorld(title) {
        const c = document.getElementById('game-canvas-container');
        
        gameScene = new THREE.Scene();
        gameScene.background = new THREE.Color(0x6eb1ff);

        gameCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
        
        gameRenderer = new THREE.WebGLRenderer({ antialias: true });
        gameRenderer.setSize(window.innerWidth, window.innerHeight);
        
        const oldCanvas = c.querySelector('canvas');
        if(oldCanvas) oldCanvas.remove();
        c.appendChild(gameRenderer.domElement);

        const light = new THREE.DirectionalLight(0xffffff, 1.2);
        light.position.set(20, 40, 20);
        gameScene.add(light, new THREE.AmbientLight(0x777777));

        gameColliders = [];
        winningPlatformRef = null;
        resetCrossroadsCombatState();

        stopCrossroadsGameMusic();
        if (activeGameRecord && activeGameRecord.type === 'studio_published') {
            buildStudioPublishedWorld(activeGameRecord.studioWorld);
        } else if (title.includes("Obby")) {
            buildObbyWorld();
        } else if (title.includes("Crossroads")) {
            buildCrossroadsWorld();
        } else if (title.includes("Dohblox HQ")) {
            buildDohbloxHQWorld();
        } else if (title.includes("Natural Disaster")) {
            buildNaturalDisasterWorld();
        } else if (title.includes("Pizza")) {
            buildPizzaPlaceWorld();
        } else {
            buildBaseplateWorld();
        }

        if (title.includes("Crossroads")) startCrossroadsGameMusic();

        currentGameAvatar = createR6Character(currentUser.colors.torso, currentUser.colors.limbs);
        refreshAvatarAccessories(currentGameAvatar);
        gameScene.add(currentGameAvatar);
        activateLocalSpawnShield(4500, false);

        playerPos = getCurrentGameSpawnPosition();
        cameraPitch = 0.3;
        cameraYaw = 0;
        updateHealthUI(100);

        if (activeGameAnimId) cancelAnimationFrame(activeGameAnimId);
        runGameLoop();
    }

    function buildBaseplateWorld() {
        const matGround = new THREE.MeshLambertMaterial({ color: 0x4C9A2A });
        const ground = new THREE.Mesh(new THREE.BoxGeometry(200, 2, 200), matGround);
        ground.position.set(0, -1, 0);
        gameScene.add(ground);
        gameColliders.push(new THREE.Box3().setFromObject(ground));

        const matSpawn = new THREE.MeshLambertMaterial({ color: 0x808080 });
        const spawn = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 0.4, 16), matSpawn);
        spawn.position.set(0, 0.2, 0);
        gameScene.add(spawn);
    }

    function buildObbyWorld() {
        gameScene.background = new THREE.Color(0x1a2636);

        const addPlatform = (x, y, z, w, h, d, color, isWin = false) => {
            const mat = new THREE.MeshLambertMaterial({ color: color });
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
            mesh.position.set(x, y, z);
            gameScene.add(mesh);
            const box = new THREE.Box3().setFromObject(mesh);
            gameColliders.push(box);
            if (isWin) winningPlatformRef = box;
        };

        addPlatform(0, 0, 0, 10, 2, 10, 0x0055b3);
        addPlatform(0, 2, -12, 6, 1.5, 6, 0xffcc00);
        addPlatform(0, 5, -24, 6, 1.5, 6, 0xff8c00);
        addPlatform(0, 8, -36, 6, 1.5, 6, 0xd80000);
        addPlatform(0, 12, -50, 12, 2, 12, 0x00b33c, true);

        const badgeText = new THREE.Mesh(new THREE.BoxGeometry(4, 1.5, 0.5), new THREE.MeshLambertMaterial({ color: 0xffff00 }));
        badgeText.position.set(0, 14, -50);
        gameScene.add(badgeText);
    }

    function buildCrossroadsWorld() {
        gameScene.background = new THREE.Color(0xf3d990);
        gameScene.fog = new THREE.Fog(0xf3d990, 180, 300);

        const grass = new THREE.MeshLambertMaterial({ color: 0x4f9b45 });
        const grass2 = new THREE.MeshLambertMaterial({ color: 0x3c8635 });
        const white = new THREE.MeshLambertMaterial({ color: 0xe9e7df });
        const gray = new THREE.MeshLambertMaterial({ color: 0x777777 });
        const dark = new THREE.MeshLambertMaterial({ color: 0x30363b });
        const black = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
        const brown = new THREE.MeshLambertMaterial({ color: 0x8b5a2b });
        const tan = new THREE.MeshLambertMaterial({ color: 0xc6a46c });
        const red = new THREE.MeshLambertMaterial({ color: 0xaa2b2b });
        const blue = new THREE.MeshLambertMaterial({ color: 0x286ba6 });
        const yellow = new THREE.MeshLambertMaterial({ color: 0xf0c33c });
        const green = new THREE.MeshLambertMaterial({ color: 0x5fa545 });
        const trunk = new THREE.MeshLambertMaterial({ color: 0x6d452c });
        const leaf = new THREE.MeshLambertMaterial({ color: 0x2e7b37 });

        const add = (x,y,z,w,h,d,mat,collide=true) => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat);
            m.position.set(x,y,z); gameScene.add(m);
            if (collide) gameColliders.push(new THREE.Box3().setFromObject(m));
            return m;
        };
        const addTree = (x,z) => {
            add(x,2,z,1.3,4,1.3,trunk,true);
            add(x,5,z,4.5,3.8,4.5,leaf,true);
        };

        // Classic-style square baseplate and crossroads.
        add(0,-1,0,190,2,190,grass,true);
        add(0,0.08,0,18,0.18,184,white,false);
        add(0,0.09,0,184,0.18,18,white,false);
        add(-9.4,0.12,0,0.8,0.12,184,brown,false);
        add(9.4,0.12,0,0.8,0.12,184,brown,false);
        add(0,0.12,-9.4,184,0.12,0.8,brown,false);
        add(0,0.12,9.4,184,0.12,0.8,brown,false);

        // Northwest green ramp / high ground.
        add(-55,2,-55,54,4,46,green,true);
        for (let i=0;i<8;i++) add(-55,0.5+i*0.65,-26-i*3.2,20,1.0+i*0.25,4,green,true);
        add(-68,8,-55,6,12,6,gray,true);
        add(-42,8,-55,6,12,6,gray,true);
        add(-55,14,-55,32,1.5,18,gray,true);

        // Northeast dark fort / office block.
        add(53,0.7,-53,58,1.4,50,dark,true);
        add(53,5.5,-53,48,9.5,40,dark,true);
        // Hollow front doorway and rooftop parapet feel.
        add(31,11,-53,4,11,40,black,true);
        add(75,11,-53,4,11,40,black,true);
        add(53,11,-73,40,11,4,black,true);
        add(40,11,-33,12,11,4,black,true);
        add(66,11,-33,12,11,4,black,true);
        add(53,16.8,-53,48,1.2,40,gray,true);

        // Southwest playground / hospital-like house.
        add(-50,4.5,48,30,9,24,tan,true);
        add(-50,9.8,48,34,1.4,28,red,true);
        // doorway gap via two front wall halves
        add(-61,4.5,35.8,8,9,2,brown,true);
        add(-39,4.5,35.8,8,9,2,brown,true);
        // playground frame
        for (const x of [-74,-64]) for (const z of [30,44]) add(x,3.3,z,1,6.6,1,blue,true);
        add(-69,6.4,30,12,1,1,blue,true); add(-69,6.4,44,12,1,1,blue,true);
        add(-74,6.4,37,1,1,15,blue,true); add(-64,6.4,37,1,1,15,blue,true);
        add(-58,1.2,66,18,2.4,10,yellow,true);
        add(-58,3.2,60,4,4,4,red,true);

        // Southeast castle with twin towers and central gate.
        add(55,4.5,53,48,9,6,brown,true);
        add(33,7,53,10,14,10,brown,true);
        add(77,7,53,10,14,10,brown,true);
        add(55,10.5,53,18,3,6,brown,true);
        add(55,4,50,10,8,4,black,true);
        // rear castle court
        add(55,0.6,70,44,1.2,28,tan,true);
        add(34,4.5,70,4,9,28,brown,true);
        add(76,4.5,70,4,9,28,brown,true);
        add(55,4.5,83,44,9,4,brown,true);

        // Center landmarks: fountain and trampoline/play structure.
        const fountainBase = new THREE.Mesh(new THREE.CylinderGeometry(6,6,1.1,18), gray);
        fountainBase.position.set(-18,0.55,18); gameScene.add(fountainBase); gameColliders.push(new THREE.Box3().setFromObject(fountainBase));
        const fountainTop = new THREE.Mesh(new THREE.CylinderGeometry(1.5,2.5,4.5,12), blue);
        fountainTop.position.set(-18,3,18); gameScene.add(fountainTop); gameColliders.push(new THREE.Box3().setFromObject(fountainTop));
        for (const x of [26,34]) for (const z of [18,30]) add(x,5,z,1,10,1,black,true);
        add(30,10,24,10,1,14,blue,true);

        // Trees along the cross-shaped roads.
        for (const v of [-75,-55,-35,35,55,75]) { addTree(v,-14); addTree(v,14); addTree(-14,v); addTree(14,v); }

        addChatMessageUI('Crossroads', 'Classic-inspired Crossroads recreation: four distinct battle-era areas around the central crossing.');
    }



    function clearDohbloxHQWorld() {
        if (hqWorldGroup && hqWorldGroup.parent) hqWorldGroup.parent.remove(hqWorldGroup);
        if (hqColliderRefs.length) {
            const refs = new Set(hqColliderRefs);
            gameColliders = gameColliders.filter(c => !refs.has(c));
        }
        hqWorldGroup = null;
        hqDestructibles = [];
        hqColliderRefs = [];
    }

    function removeHQCollider(collider) {
        const gi = gameColliders.indexOf(collider);
        if (gi >= 0) gameColliders.splice(gi, 1);
        const hi = hqColliderRefs.indexOf(collider);
        if (hi >= 0) hqColliderRefs.splice(hi, 1);
    }

    function destroyDohbloxHQPiece(piece) {
        if (!piece) return;
        if (piece.mesh && piece.mesh.parent) piece.mesh.parent.remove(piece.mesh);
        if (piece.collider) removeHQCollider(piece.collider);
        const idx = hqDestructibles.indexOf(piece);
        if (idx >= 0) hqDestructibles.splice(idx, 1);
    }

    function damageDohbloxHQStructures(position, kind) {
        if (!isDohbloxHQActive() || !position) return;
        const radius = kind === 'bomb' ? 7.4 : (kind === 'rocket' ? 5.8 : 3.6);
        const maxDamage = kind === 'bomb' ? 90 : (kind === 'rocket' ? 60 : 28);
        const nearest = new THREE.Vector3();

        for (let i = hqDestructibles.length - 1; i >= 0; i--) {
            const piece = hqDestructibles[i];
            if (!piece.collider) continue;
            piece.collider.clampPoint(position, nearest);
            const distance = nearest.distanceTo(position);
            if (distance > radius) continue;
            const falloff = Math.max(0.32, 1 - (distance / radius) * 0.68);
            piece.hp -= maxDamage * falloff;
            if (piece.hp <= 0) destroyDohbloxHQPiece(piece);
        }
    }

    function scheduleDohbloxHQReset() {
        if (hqResetTimer) clearTimeout(hqResetTimer);
        hqResetTimer = setTimeout(() => {
            if (isDohbloxHQActive()) resetDohbloxHQWorld(true);
        }, DOHBLOX_HQ_RESET_MS);
    }

    function resetDohbloxHQWorld(shouldBroadcast = false) {
        if (!isDohbloxHQActive()) return;
        const now = Date.now();
        if (now - hqLastResetAt < 3500) return;
        hqLastResetAt = now;
        buildDohbloxHQWorld();
        addChatMessageUI('System', 'Dohblox HQ has rebuilt to its original state.');
        if (shouldBroadcast) sendNetworkMessage('HQ_RESET', { at: now });
    }

    function cleanupDohbloxHQState() {
        if (hqResetTimer) {
            clearTimeout(hqResetTimer);
            hqResetTimer = null;
        }
        clearDohbloxHQWorld();
        hqLastResetAt = 0;
    }

    function hqPlayerBoxAt(x, z) {
        return new THREE.Box3().setFromCenterAndSize(
            new THREE.Vector3(x, playerPos.y + 1.4, z),
            new THREE.Vector3(0.82, 2.65, 0.82)
        );
    }

    function hqPositionBlocked(x, z) {
        const box = hqPlayerBoxAt(x, z);
        for (const c of gameColliders) {
            // Surfaces at/below the feet are floors, not side walls.
            if (c.max.y <= playerPos.y + 0.18) continue;
            if (c.min.y >= playerPos.y + 2.72) continue;
            if (box.intersectsBox(c)) return true;
        }
        return false;
    }

    function resolveDohbloxHQHorizontalCollision(previousX, previousZ) {
        if (!isDohbloxHQActive()) return;
        const attemptedX = playerPos.x;
        const attemptedZ = playerPos.z;
        if (hqPositionBlocked(attemptedX, previousZ)) playerPos.x = previousX;
        if (hqPositionBlocked(playerPos.x, attemptedZ)) playerPos.z = previousZ;
    }

    function buildDohbloxHQWorld() {
        clearDohbloxHQWorld();
        gameScene.background = new THREE.Color(0xc9d7df);
        gameScene.fog = new THREE.Fog(0xc9d7df, 170, 330);
        hqWorldGroup = new THREE.Group();
        hqWorldGroup.name = 'dohbloxHQWorld';
        gameScene.add(hqWorldGroup);

        const grassMat = new THREE.MeshLambertMaterial({ color: 0x3f9b45 });
        const waterMat = new THREE.MeshLambertMaterial({ color: 0x4b9bb8, transparent: true, opacity: 0.86 });
        const roadMat = new THREE.MeshLambertMaterial({ color: 0x595959 });
        const walkMat = new THREE.MeshLambertMaterial({ color: 0xa8a8a8 });
        const redPathMat = new THREE.MeshLambertMaterial({ color: 0xb84343 });
        const glassMat = new THREE.MeshPhongMaterial({ color: 0x155f86, shininess: 85, transparent: true, opacity: 0.88 });
        const glassLightMat = new THREE.MeshPhongMaterial({ color: 0x237fa7, shininess: 95, transparent: true, opacity: 0.86 });
        const frameMat = new THREE.MeshLambertMaterial({ color: 0x123748 });
        const frameDarkMat = new THREE.MeshLambertMaterial({ color: 0x0b2634 });
        const redMat = new THREE.MeshLambertMaterial({ color: 0xb52828 });
        const concreteMat = new THREE.MeshLambertMaterial({ color: 0x707b7e });
        const floorMat = new THREE.MeshLambertMaterial({ color: 0x8a8f91 });
        const stairMat = new THREE.MeshLambertMaterial({ color: 0x6f7578 });
        const interiorMat = new THREE.MeshLambertMaterial({ color: 0xbfc8cc });
        const blackMat = new THREE.MeshLambertMaterial({ color: 0x151515 });

        const registerCollider = (mesh, destructible = false, hp = 50) => {
            mesh.updateMatrixWorld(true);
            const collider = new THREE.Box3().setFromObject(mesh);
            gameColliders.push(collider);
            hqColliderRefs.push(collider);
            if (destructible) hqDestructibles.push({ mesh, collider, hp, maxHp: hp });
            return collider;
        };
        const addBox = (x,y,z,w,h,d,mat,collide=true,destructible=false,hp=50) => {
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat);
            mesh.position.set(x,y,z); hqWorldGroup.add(mesh);
            if (collide) registerCollider(mesh, destructible, hp);
            return mesh;
        };
        const addPanel = (x,y,z,w,h,d,mat=glassMat,hp=42) => addBox(x,y,z,w,h,d,mat,true,true,hp);
        const addStairs = (x,z,baseY,dirX,dirZ,steps=8,rise=0.5,run=1.1,width=4.2) => {
            for (let i=0;i<steps;i++) {
                const top = (i+1)*rise;
                const sx = x + dirX*(i*run + run/2);
                const sz = z + dirZ*(i*run + run/2);
                const w = dirX ? run : width;
                const d = dirZ ? run : width;
                addBox(sx,baseY+top/2,sz,w,top,d,stairMat,true,false);
            }
        };
        const addTowerShell = (cx,cz,w,d,floors,floorH,mat) => {
            for (let f=0; f<floors; f++) {
                const y0 = f*floorH;
                addBox(cx,y0+0.3,cz,w,0.6,d,floorMat,true,false);
                const cy = y0 + floorH/2;
                const sideH = floorH-0.4;
                // front/back panels with a centered opening on ground floor only
                if (f===0) {
                    const gap=5.5, half=(w-gap)/2;
                    addPanel(cx-(gap/2+half/2),cy,cz+d/2,half,sideH,0.6,mat);
                    addPanel(cx+(gap/2+half/2),cy,cz+d/2,half,sideH,0.6,mat);
                } else {
                    addPanel(cx,cy,cz+d/2,w,sideH,0.6,mat);
                }
                addPanel(cx,cy,cz-d/2,w,sideH,0.6,mat);
                addPanel(cx-w/2,cy,cz,0.6,sideH,d,mat);
                addPanel(cx+w/2,cy,cz,0.6,sideH,d,mat);

                // switchback stair flight inside each floor.
                const leftToRight = (f % 2 === 0);
                const startX = leftToRight ? cx-w/2+2.4 : cx+w/2-2.4;
                addStairs(startX, cz+2.0, y0+0.6, leftToRight?1:-1, 0, 8, (floorH-0.6)/8, (w-5.0)/8, 3.4);
                addBox(cx, y0+floorH-0.25, cz+2.0, 4.0, 0.5, 4.0, floorMat, true, false);
            }
            addBox(cx,floors*floorH+0.3,cz,w,0.6,d,floorMat,true,false);
        };

        // Island, roads and front plaza.
        addBox(0,-2.2,-38,310,2,310,waterMat,false);
        addBox(0,-0.75,-38,190,1.5,180,grassMat,true,false);
        addBox(0,0.10,18,15,0.20,96,roadMat,false);
        addBox(0,0.11,-7,94,0.22,13,roadMat,false);
        addBox(0,0.24,-20,11,0.22,34,redPathMat,false);
        addBox(-23,0.23,-21,34,0.20,5,walkMat,false);
        addBox(23,0.23,-21,34,0.20,5,walkMat,false);
        addBox(0,0.40,-47,79,0.8,43,concreteMat,true,false);

        // Hollow central lobby, open front doors, real interior.
        addBox(0,0.65,-43,54,0.5,30,floorMat,true,false);
        addPanel(-27,7,-43,0.7,13,30,glassMat,55);
        addPanel(27,7,-43,0.7,13,30,glassMat,55);
        addPanel(0,7,-58,54,13,0.7,glassMat,55);
        // front wall split around an 11-wide entrance
        addPanel(-16.25,7,-28,21.5,13,0.7,glassLightMat,50);
        addPanel(16.25,7,-28,21.5,13,0.7,glassLightMat,50);
        addBox(0,13.4,-43,54,0.8,30,floorMat,true,false);
        // interior reception and columns
        addBox(0,2.0,-38,13,2.4,3.5,redMat,true,true,44);
        for (const x of [-20,-10,10,20]) addBox(x,6.6,-43,1.0,12,1.0,frameDarkMat,true,true,36);

        // Two fully enterable towers with floors and staircases all the way up.
        addTowerShell(-18,-50,18,18,10,5.0,glassMat);
        addTowerShell(18,-50,19,19,13,5.0,glassLightMat);

        // Open connectors from lobby to towers at several levels.
        for (const y of [3.0,8.0,13.0]) {
            addBox(-9,y,-50,9,0.6,6,floorMat,true,false);
            addBox(9,y,-50,9,0.6,6,floorMat,true,false);
        }

        // Exterior spires.
        for (let i=0;i<7;i++) addPanel(-22.5,53+i*7.5,-50,1.8,7.0,1.8,frameDarkMat,28);
        for (let i=0;i<10;i++) addPanel(20.0,68+i*7.0,-50,1.8,6.5,1.8,frameDarkMat,28);

        // Side wings, hollow and enterable.
        for (const sx of [-36,36]) {
            addBox(sx,0.55,-45,12,0.5,24,floorMat,true,false);
            addPanel(sx-6,5,-45,0.6,9,24,glassMat,42);
            addPanel(sx+6,5,-45,0.6,9,24,glassMat,42);
            addPanel(sx,5,-57,12,9,0.6,glassMat,42);
            addPanel(sx,5,-33,12,9,0.6,glassMat,42);
            addBox(sx,9.6,-45,12,0.6,24,floorMat,true,false);
        }

        // DOHBLOX HQ sign.
        const signCanvas = document.createElement('canvas');
        signCanvas.width = 512; signCanvas.height = 192;
        const sctx = signCanvas.getContext('2d');
        sctx.font = '900 78px Arial Black, Impact, sans-serif'; sctx.textAlign='center'; sctx.textBaseline='middle';
        sctx.lineWidth=10; sctx.strokeStyle='#ffffff'; sctx.strokeText('DOHBLOX',256,63);
        sctx.fillStyle='#d41414'; sctx.fillText('DOHBLOX',256,63);
        sctx.font='900 65px Arial Black, Impact, sans-serif'; sctx.strokeText('HQ',256,142); sctx.fillText('HQ',256,142);
        const signTexture = new THREE.CanvasTexture(signCanvas);
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(19,7.2), new THREE.MeshBasicMaterial({map:signTexture,transparent:true,side:THREE.DoubleSide,depthWrite:false}));
        sign.position.set(28,5.8,-17.5); hqWorldGroup.add(sign);
        addBox(22,2.4,-17.6,0.8,4.8,0.8,concreteMat,true,true,35);
        addBox(34,2.4,-17.6,0.8,4.8,0.8,concreteMat,true,true,35);

        // Spawn pad.
        const spawn = new THREE.Mesh(new THREE.CylinderGeometry(4.5,4.5,0.55,16), new THREE.MeshLambertMaterial({color:0x8b8b8b}));
        spawn.position.set(0,0.35,55); hqWorldGroup.add(spawn);
        const spawnCollider = new THREE.Box3().setFromObject(spawn);
        gameColliders.push(spawnCollider);
        hqColliderRefs.push(spawnCollider);

        scheduleDohbloxHQReset();
        addChatMessageUI('HQ', 'The lobby and both towers are enterable. Use the interior stairs to reach the roofs.');
        addChatMessageUI('HQ', 'HQ weapons are restored: Sword, Rocket, Bomb, Slingshot, and Trowel. Explosions destroy breakable HQ sections; it rebuilds every 10 minutes.');
    }

    function buildPizzaPlaceWorld() {
        gameScene.background = new THREE.Color(0x76b9ef);
        gameScene.fog = new THREE.Fog(0x76b9ef, 180, 340);
        pizzaInteractables=[]; pizzaCustomers=[]; pizzaCustomerCounter=0; pizzaActiveOrderCustomerId=null;
        pizzaLastCustomerSpawnAt=performance.now()-PIZZA_CUSTOMER_SPAWN_MS; pizzaSupplierLoaded=false; pizzaCompletedOrders=0;
        pizzaHouseOutlines={}; pizzaHouseDropPoints={}; pizzaJobAnimation=null; pizzaInCar=false; pizzaInBike=false; pizzaDeliveryDriveStarted=false;
        ensurePizzaProgress(); resetPizzaOrder(); ensurePizzaHud(); ensurePizzaShopUI();

        const grass=new THREE.MeshLambertMaterial({color:0x4d9b45}), road=new THREE.MeshLambertMaterial({color:0x44484d}), sidewalk=new THREE.MeshLambertMaterial({color:0xb8b8b8});
        const brick=new THREE.MeshLambertMaterial({color:0x8e4f42}), tan=new THREE.MeshLambertMaterial({color:0xd5c3a5}), cream=new THREE.MeshLambertMaterial({color:0xeee1ca}), black=new THREE.MeshLambertMaterial({color:0x222222});
        const red=new THREE.MeshLambertMaterial({color:0xc7352f}), yellow=new THREE.MeshLambertMaterial({color:0xf3c53c}), steel=new THREE.MeshLambertMaterial({color:0x7e858a}), white=new THREE.MeshLambertMaterial({color:0xf4f4ef});
        const blue=new THREE.MeshLambertMaterial({color:0x448ac1}), brown=new THREE.MeshLambertMaterial({color:0x7b5536}), green=new THREE.MeshLambertMaterial({color:0x478b48});
        const glass=new THREE.MeshPhongMaterial({color:0x8fd4e6,transparent:true,opacity:.55,shininess:70});
        const add=(x,y,z,w,h,d,mat,collide=true)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);gameScene.add(m);if(collide)gameColliders.push(new THREE.Box3().setFromObject(m));return m;};
        const label=(text,x,y,z,w=8,h=2.2)=>{const c=document.createElement('canvas');c.width=512;c.height=128;const ctx=c.getContext('2d');ctx.font='bold 54px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineWidth=8;ctx.strokeStyle='#fff';ctx.strokeText(text,256,64);ctx.fillStyle='#d52a2a';ctx.fillText(text,256,64);const tex=new THREE.CanvasTexture(c);const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:tex,transparent:true,side:THREE.DoubleSide}));m.position.set(x,y,z);gameScene.add(m);return m;};
        const pad=(id,x,z,color=0xf3c53c)=>{add(x,.22,z,4.2,.35,4.2,new THREE.MeshLambertMaterial({color}),false);pizzaInteractables.push({id,x,z});};
        const addTree=(x,z)=>{add(x,2,z,1.3,4,1.3,brown,true);add(x,5,z,5,4,5,green,true);};

        add(0,-1,0,240,2,220,grass,true); add(0,.05,28,170,.2,18,road,false); add(-56,.05,-14,18,.2,110,road,false); add(56,.05,-14,18,.2,110,road,false); add(0,.08,18,170,.15,4,sidewalk,false); add(0,.08,38,170,.15,4,sidewalk,false);
        const px=0,pz=-18,pw=74,pd=46,wallH=11;
        add(px,.45,pz,pw,.8,pd,cream,true); add(px-pw/2,wallH/2,pz,1,wallH,pd,brick,true); add(px+pw/2,wallH/2,pz,1,wallH,pd,brick,true); add(px,wallH/2,pz-pd/2,pw,wallH,1,brick,true);
        add(-25,wallH/2,pz+pd/2,24,wallH,1,brick,true); add(25,wallH/2,pz+pd/2,24,wallH,1,brick,true); add(-10,7,pz+pd/2+.05,16,6,.4,glass,true); add(10,7,pz+pd/2+.05,16,6,.4,glass,true); add(px,11.2,pz,pw,.8,pd,black,true); label('DOHBLOX PIZZA',0,10.5,pz+pd/2+.7,24,4);

        add(-10,1.8,pz+10,36,2.4,3,red,true); for(const x of [-26,-18,-10,-2,14,22,30]) add(x,1.2,pz+16,4,1.2,4,brown,true); pad('cashier',-10,pz+6,0xffd24a); label('CASHIER',-10,3.5,pz+6,9,2.2);

        // PREP TABLE + VISIBLE PIZZA
        add(0,5.5,pz-2,1,10,24,tan,true); add(-20,1.5,pz-8,22,2.2,5,steel,true); pad('prep',-20,pz-3,0x66bb6a); label('PREP',-20,3.3,pz-3,7,2);
        pizzaPrepPizzaVisual=createPizzaDisc(); pizzaPrepPizzaVisual.position.set(-20,2.9,pz-8); pizzaPrepPizzaVisual.rotation.x=-Math.PI/2; pizzaPrepPizzaVisual.visible=false; gameScene.add(pizzaPrepPizzaVisual);
        for(let i=0;i<3;i++){const ing=new THREE.Mesh(new THREE.CylinderGeometry(.55,.55,.5,12),new THREE.MeshLambertMaterial({color:[0xf1df7a,0xc33a35,0x71a95a][i]}));ing.position.set(-26+i*3,2.9,pz-8);gameScene.add(ing);}

        // ACTUAL OVENS: metal bodies, doors, windows, orange interiors and handles.
        pizzaOvenGlowVisuals=[];
        for(const [idx,x] of [-22,-16,-10].entries()){
            add(x,3.25,pz-18,5.3,5.8,3.8,new THREE.MeshLambertMaterial({color:0x575b60}),true);
            const glow=new THREE.Mesh(new THREE.PlaneGeometry(3.5,2.2),new THREE.MeshBasicMaterial({color:0xff7a18,transparent:true,opacity:.55,side:THREE.DoubleSide})); glow.position.set(x,3.35,pz-15.98); gameScene.add(glow); pizzaOvenGlowVisuals.push(glow);
            const door=new THREE.Mesh(new THREE.BoxGeometry(4.2,2.9,.22),new THREE.MeshPhongMaterial({color:0x232323,shininess:45})); door.position.set(x,3.2,pz-15.8); gameScene.add(door);
            const win=new THREE.Mesh(new THREE.PlaneGeometry(3.25,1.65),new THREE.MeshBasicMaterial({color:0x5b2a0d,transparent:true,opacity:.7})); win.position.set(x,3.3,pz-15.67); gameScene.add(win);
            add(x,4.9,pz-15.55,3.2,.22,.22,steel,false);
            label(`OVEN ${idx+1}`,x,6.6,pz-15.5,5.5,1.3);
        }
        pad('oven',-16,pz-14,0xff8844); label('OVENS',-16,7.8,pz-15.5,8,1.8);
        pizzaOvenPizzaVisual=createPizzaDisc(0xf7c94a); pizzaOvenPizzaVisual.scale.set(.8,.8,.8); pizzaOvenPizzaVisual.position.set(-16,3.15,-30); pizzaOvenPizzaVisual.rotation.x=-Math.PI/2; pizzaOvenPizzaVisual.visible=false; gameScene.add(pizzaOvenPizzaVisual);

        // BOXING TABLE + stacks of recognizable pizza boxes.
        add(18,1.6,pz-7,22,2.4,5,steel,true); pad('boxer',18,pz-3,0x6fa8dc); label('BOXING',18,3.3,pz-3,9,2);
        const boxMat=new THREE.MeshLambertMaterial({color:0xf3e3be});
        for(let stack=0;stack<3;stack++) for(let j=0;j<4;j++){const b=new THREE.Mesh(new THREE.BoxGeometry(4.1,.32,4.1),boxMat);b.position.set(12+stack*5,3.0+j*.34,pz-7);gameScene.add(b);const stripe=new THREE.Mesh(new THREE.BoxGeometry(4.2,.08,.25),red);stripe.position.set(12+stack*5,3.02+j*.34,pz-4.92);gameScene.add(stripe);}
        pizzaBoxVisual=new THREE.Group(); const base=new THREE.Mesh(new THREE.BoxGeometry(4.2,.38,4.2),boxMat); pizzaBoxVisual.add(base); pizzaBoxLidVisual=new THREE.Mesh(new THREE.BoxGeometry(4.2,.22,4.2),boxMat); pizzaBoxLidVisual.position.set(0,.4,-1.9); pizzaBoxLidVisual.rotation.x=-1.2; pizzaBoxVisual.add(pizzaBoxLidVisual); pizzaBoxVisual.position.set(18,3.05,pz-7); pizzaBoxVisual.visible=false; gameScene.add(pizzaBoxVisual);
        pizzaDeliveryBoxVisual=new THREE.Mesh(new THREE.BoxGeometry(2.2,.38,2.2),boxMat); pizzaDeliveryBoxVisual.visible=false; gameScene.add(pizzaDeliveryBoxVisual);

        add(28,1.5,pz-16,10,2.2,5,red,true);
        add(26,5.5,pz+8,1,10,14,tan,true); add(31,5.5,pz+1,10,10,1,tan,true); add(31,5.5,pz+15,10,10,1,tan,true); add(36,5.5,pz+8,1,10,14,tan,true); add(31,1.7,pz+8,6,2.2,3,brown,true); pad('manager',31,pz+4,0xaa88cc); label('MANAGER',31,3.4,pz+4,9,2);

        // UPGRADE SHOP kiosk; Pizza Dohbux only.
        add(25,1.6,16,10,2.4,6,yellow,true); pad('upgrade_shop',25,20,0xf1c232); label('UPGRADES',25,4.2,20,10,2.2);

        add(-44,.07,pz,8,.16,52,road,false); add(-37.5,3.2,pz+5,.8,6,10,red,true); add(20,.35,pz-pd/2-7,28,.7,14,sidewalk,true); pad('supplier_drop',20,pz-pd/2-8,0x55aaff); label('LOADING DOCK',20,3,pz-pd/2-8,12,2);
        const wz=-70; add(-58,.45,wz,38,.8,34,steel,true); add(-77,5.5,wz,1,10,34,steel,true); add(-39,5.5,wz,1,10,34,steel,true); add(-58,5.5,wz-17,38,10,1,steel,true); add(-68,5.5,wz+17,18,10,1,steel,true); add(-48,5.5,wz+17,14,10,1,steel,true); add(-58,10.6,wz,38,.8,34,black,true); pad('supplier_pickup',-58,wz,0x55aaff); label('SUPPLIER',-58,4,wz,11,2.4);
        for(let i=0;i<12;i++) add(-71+(i%4)*7,1.2,wz-10+Math.floor(i/4)*8,4,2.4,4,[red,yellow,green,blue][i%4],true);

        const houses=[['A1',78,0],['A2',78,-34],['B1',78,-68],['B2',-88,5],['C1',-88,-30],['C2',-88,-65]];
        for(const [name,hx,hz] of houses){
            add(hx,3.5,hz,20,7,18,tan,true); add(hx,7.7,hz,22,1.4,20,red,true); add(hx-6.5,3.5,hz+9.2,7,7,1,brick,true); add(hx+6.5,3.5,hz+9.2,7,7,1,brick,true); label(name,hx,7,hz+10,5,2.3); pad('house_'+name,hx,hz+12,0xffdd66);
            const edge=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(23,10,21)),new THREE.LineBasicMaterial({color:0xffffff})); edge.position.set(hx,4.8,hz); edge.visible=false; gameScene.add(edge); pizzaHouseOutlines[name]=edge; pizzaHouseDropPoints[name]={x:hx,z:hz+12};
        }

        pizzaDeliveryCar=createPizzaDeliveryCar();
        pizzaDeliveryBike=createPizzaDeliveryBike();
        startPizzaGameMusic();
        add(PIZZA_CAR_PARK.x,.08,PIZZA_CAR_PARK.z,15,.16,12,new THREE.MeshLambertMaterial({color:0xd8d8d8}),false); label('DELIVERY CAR',PIZZA_CAR_PARK.x,4.5,PIZZA_CAR_PARK.z-5.5,11,2);
        add(PIZZA_BIKE_PARK.x,.08,PIZZA_BIKE_PARK.z,8,.16,10,new THREE.MeshLambertMaterial({color:0xd8d8d8}),false); label('DELIVERY BIKE',PIZZA_BIKE_PARK.x,4.1,PIZZA_BIKE_PARK.z-4.6,11,2);
        for(const z of [-88,-52,8,58]){addTree(-72,z);addTree(72,z);}
        updatePizzaHouseOutline(); updatePizzaHud();

        setTimeout(()=>{if(isPizzaPlaceActive()){spawnPizzaCustomer(true);setTimeout(()=>{if(isPizzaPlaceActive())spawnPizzaCustomer(true);},1200);addChatMessageUI('Pizza Job','Serve customers: CASHIER → PREP → OVENS → BOXING → white-outlined house. Walk, drive the car, or ride the bike.');addChatMessageUI('Pizza Job','Each player can work a separate customer order at the same time.');addChatMessageUI('Pizza Job',`Pizza Dohbux are separate job money.${isPizzaWeekend()?' Weekend pay is 2× right now!':''} Original Pizza Place game music is playing.`);}},150);
    }

    function runGameLoop() {
        activeGameAnimId = requestAnimationFrame(runGameLoop);
        const worldNow = performance.now();
        const worldDt = Math.min(0.05, Math.max(0.001, (worldNow - worldLastFrameTime) / 1000));
        worldLastFrameTime = worldNow;

        let moveVector = { x: 0, z: 0 };
        let moveSpeed = 0.22;
        const previousX = playerPos.x;
        const previousZ = playerPos.z;

        if (isPizzaPlaceActive() && ((pizzaInCar && pizzaDeliveryCar) || (pizzaInBike && pizzaDeliveryBike))) {
            const usingBike = pizzaInBike && pizzaDeliveryBike;
            const vehicle = usingBike ? pizzaDeliveryBike : pizzaDeliveryCar;
            let throttle = 0, steer = 0;
            if (keysPressed['KeyW'] || keysPressed['ArrowUp']) throttle += 1;
            if (keysPressed['KeyS'] || keysPressed['ArrowDown']) throttle -= 1;
            if (keysPressed['KeyA'] || keysPressed['ArrowLeft']) steer += 1;
            if (keysPressed['KeyD'] || keysPressed['ArrowRight']) steer -= 1;
            if (usingBike) {
                if (Math.abs(throttle) > 0.01) pizzaBikeYaw += steer * 0.06 * (throttle >= 0 ? 1 : -1);
                const speed = 0.34 * throttle;
                playerPos.x += Math.sin(pizzaBikeYaw) * speed;
                playerPos.z += Math.cos(pizzaBikeYaw) * speed;
                vehicle.position.set(playerPos.x,.15,playerPos.z); vehicle.rotation.y=pizzaBikeYaw;
                cameraYaw=pizzaBikeYaw+Math.PI;
                playPizzaVehicleRollingSound('bike', throttle);
            } else {
                if (Math.abs(throttle) > 0.01) pizzaCarYaw += steer * 0.045 * (throttle >= 0 ? 1 : -1);
                const speed = 0.48 * throttle;
                playerPos.x += Math.sin(pizzaCarYaw) * speed;
                playerPos.z += Math.cos(pizzaCarYaw) * speed;
                vehicle.position.set(playerPos.x,.35,playerPos.z); vehicle.rotation.y=pizzaCarYaw;
                cameraYaw=pizzaCarYaw+Math.PI;
                playPizzaVehicleRollingSound('car', throttle);
            }
            if (currentGameAvatar) {
                if (usingBike) positionPizzaBikeRider();
                else currentGameAvatar.visible=false;
            }
        } else {
            if (keysPressed['KeyW'] || keysPressed['ArrowUp']) moveVector.z -= 1;
            if (keysPressed['KeyS'] || keysPressed['ArrowDown']) moveVector.z += 1;
            if (keysPressed['KeyA'] || keysPressed['ArrowLeft']) moveVector.x -= 1;
            if (keysPressed['KeyD'] || keysPressed['ArrowRight']) moveVector.x += 1;
            if (moveVector.x !== 0 || moveVector.z !== 0) {
                const length=Math.hypot(moveVector.x,moveVector.z), normX=moveVector.x/length, normZ=moveVector.z/length;
                const sin=Math.sin(cameraYaw), cos=Math.cos(cameraYaw);
                const dx=(normX*cos+normZ*sin)*moveSpeed, dz=(-normX*sin+normZ*cos)*moveSpeed;
                playerPos.x+=dx; playerPos.z+=dz;
                currentGameAvatar.rotation.y=Math.atan2(dx,dz); playStepSound();
                walkCycleTimer+=.2; const legAngle=Math.sin(walkCycleTimer)*.5;
                const leftLeg=currentGameAvatar.getObjectByName('leftLegGroup'), rightLeg=currentGameAvatar.getObjectByName('rightLegGroup');
                if(leftLeg)leftLeg.rotation.x=legAngle; if(rightLeg)rightLeg.rotation.x=-legAngle;
            }
            resolveSolidWorldHorizontalCollision(previousX, previousZ);
        }

        // GRAVITY & COLLISION PHYSICS
        playerVelocityY -= 0.015 * ((activeGameRecord && activeGameRecord.type === 'studio_published') ? studioRuntimeGravity : 1);
        playerPos.y += playerVelocityY;

        isGrounded = false;
        const playerBox = new THREE.Box3().setFromCenterAndSize(
            new THREE.Vector3(playerPos.x, playerPos.y + 1.4, playerPos.z),
            new THREE.Vector3(0.8, 2.8, 0.8)
        );

        gameColliders.forEach(c => {
            if (playerBox.intersectsBox(c)) {
                if (playerVelocityY < 0 && playerPos.y >= c.min.y) {
                    playerPos.y = c.max.y;
                    playerVelocityY = 0;
                    isGrounded = true;
                }
            }
        });

        resolveNaturalDisasterFloorSafety();

        updateStudioPublishedRuntime(worldDt, playerBox);

        if (winningPlatformRef && playerBox.intersectsBox(winningPlatformRef)) {
            triggerObbyBadgeWin();
        }

        // VOID RESPAWN
        if (playerPos.y < -30) {
            playerPos = getCurrentGameSpawnPosition();
            playerVelocityY = 0;
            updateHealthUI(playerHealth - 20);
            activateLocalSpawnShield(4500, true);
        }

        currentGameAvatar.position.set(playerPos.x, playerPos.y, playerPos.z);
        if (pizzaInBike && pizzaDeliveryBike) positionPizzaBikeRider();

        // CAMERA ORBIT CONTROLS
        const camDistance = 8.5;
        gameCamera.position.x = playerPos.x + camDistance * Math.sin(cameraYaw) * Math.cos(cameraPitch);
        gameCamera.position.y = playerPos.y + 2.0 + camDistance * Math.sin(cameraPitch);
        gameCamera.position.z = playerPos.z + camDistance * Math.cos(cameraYaw) * Math.cos(cameraPitch);
        gameCamera.lookAt(playerPos.x, playerPos.y + 2.0, playerPos.z);

        // WEAPON SWING ANIMATION
        if (isAttacking) {
            attackSwingTimer += 0.2;
            const rightArm = currentGameAvatar.getObjectByName('rightArmGroup');
            if (rightArm) rightArm.rotation.x = -Math.sin(attackSwingTimer) * 1.5;

            if (attackSwingTimer >= Math.PI) {
                isAttacking = false;
                if (rightArm) rightArm.rotation.x = 0;
            }
        }

        updateDanceAnimations(moveVector.x !== 0 || moveVector.z !== 0 || pizzaInBike || pizzaInCar);
        updatePizzaJobAnimation(worldNow);
        updatePizzaCustomers(worldNow, worldDt);
        updateNaturalDisasterGame(worldNow, worldDt);
        updateCrossroadsCombat();
        updateOverheadBubblesPosition();
        gameRenderer.render(gameScene, gameCamera);
    }

    function updateHeldWeaponMesh() {
        if (!currentGameAvatar) return;

        if (equippedWeaponMesh) {
            equippedWeaponMesh.parent.remove(equippedWeaponMesh);
            equippedWeaponMesh = null;
        }

        if (activeEquippedWeapon) {
            const rightArmGroup = currentGameAvatar.getObjectByName('rightArmGroup');
            if (rightArmGroup) {
                equippedWeaponMesh = create3DAccessoryMesh(activeEquippedWeapon.type);
                equippedWeaponMesh.position.set(0, -0.8, 0.3);
                equippedWeaponMesh.rotation.x = Math.PI / 2;
                rightArmGroup.add(equippedWeaponMesh);
            }
        }
    }

    function resetInGameCharacter() {
        playerPos = getCurrentGameSpawnPosition();
        playerVelocityY = 0;
        updateHealthUI(100);
        toggleInGameMenu();
    }

    function toggleInGameMenu() {
        const menu = document.getElementById('roblox-2009-menu-overlay');
        menu.classList.toggle('hidden');
    }

    function switch2009MenuTab(tab) {
        ['players', 'settings', 'help'].forEach(t => {
            document.getElementById(`r2009-menu-sub-${t}`).classList.add('hidden');
            document.getElementById(`r2009-tab-btn-${t}`).classList.remove('active');
        });
        document.getElementById(`r2009-menu-sub-${tab}`).classList.remove('hidden');
        document.getElementById(`r2009-tab-btn-${tab}`).classList.add('active');
    }

    function closeGameViewport() {
        if (activeGameAnimId) cancelAnimationFrame(activeGameAnimId);
        if (heartbeatTimer) clearInterval(heartbeatTimer);

        cleanupCrossroadsCombat();
        cleanupDohbloxHQState();
        cleanupPizzaPlaceState();
        cleanupNaturalDisasterState();
        cleanupStudioPublishedRuntime();
        stopCrossroadsGameMusic();
        stopBoomboxMusic();
        localDanceUntil = 0;
        sendNetworkMessage('LEAVE_GAME', {});
        leaveCloudGameRoom(true);
        activeGameTitle = null;

        for (let id in remotePlayers) {
            removeRemotePlayer(id);
        }

        document.getElementById('game-viewport-modal').classList.add('hidden');
        document.getElementById('roblox-2009-menu-overlay').classList.add('hidden');
        if(activeGameRecord && activeGameRecord.temporary) gamesDatabase = gamesDatabase.filter(g=>g.id!==activeGameRecord.id);
        activeGameRecord = null;
        if(studioReturnAfterTest){studioReturnAfterTest=false;setTimeout(openDohbloxStudio,80);}
    }