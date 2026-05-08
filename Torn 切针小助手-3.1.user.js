// ==UserScript==
// @name         Torn 切针小助手
// @namespace    http://tampermonkey.net/
// @version      3.2
// @description  快速切针/切雷（帮派优先），兼容手机，自动检测当前状态，防止重复切换，切换失败提示，窗口开关/拖拽/倍率缩放。支持拖拽排序自定义按钮顺序（长按1秒进入排序模式）。
// @match        https://www.torn.com/item.php*
// @author       2687001&DeepSeek
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function() {
    'use strict';

    // ==================== 用户配置 ====================
    const CONFIG = {
        DESKTOP_DEFAULT_SCALE: 1.0,
        MOBILE_DEFAULT_SCALE: 1.0,
        MIN_SCALE: 0.5,
        MAX_SCALE: 2.0,
        MONITOR_INTERVAL: 800,
        EQUIP_TIMEOUT: 5000,
        LONG_PRESS_DURATION: 1000,      // 长按进入排序模式的时间（毫秒）
        SORT_MODE_BUTTON_SCALE: 0.85,   // 排序模式下按钮文字缩放比例
    };

    // ==================== 针剂配置 ====================
    const BOOSTER_LIST = [
        { id: 464, name: 'Melatonin',   displayName: '速度', fullName: '速度针', color: '#dfdf00', category: 'booster' },
        { id: 463, name: 'Epinephrine', displayName: '力量', fullName: '力量针', color: '#ae3a00', category: 'booster' },
        { id: 814, name: 'Tyrosine',    displayName: '敏捷', fullName: '敏捷针', color: '#a700ff', category: 'booster' },
        { id: 465, name: 'Serotonin',   displayName: '防御', fullName: '防御针', color: '#00ddeb', category: 'booster' }
    ];

    // ==================== 手雷配置 ====================
    const GRENADE_LIST = [
        { id: 226, name: 'Smoke Grenade', displayName: '烟雾', fullName: '烟雾弹', color: '#9b59b6', category: 'grenade' },
        { id: 222, name: 'Flash Grenade', displayName: '闪光', fullName: '闪光弹', color: '#9b59b6', category: 'grenade' },
        { id: 256, name: 'Tear Gas',      displayName: '催泪', fullName: '催泪瓦斯', color: '#9b59b6', category: 'grenade' },
        { id: 392, name: 'Pepper Spray',  displayName: '胡椒', fullName: '胡椒喷雾', color: '#9b59b6', category: 'grenade' },
        { id: 242, name: 'HEG',           displayName: '高爆', fullName: '高爆弹', color: '#9b59b6', category: 'grenade' }
    ];

    // 构建映射表
    const GRENADE_CONFIG = {};
    GRENADE_LIST.forEach(g => { GRENADE_CONFIG[g.id] = g; });
    const BOOSTER_CONFIG = {};
    BOOSTER_LIST.forEach(b => { BOOSTER_CONFIG[b.id] = b; });

    const ALL_ITEMS = [...BOOSTER_LIST, ...GRENADE_LIST];

    // 存储顺序的 key
    const STORAGE_KEYS = {
        BOOSTER_ORDER: 'torn_booster_order',
        GRENADE_ORDER: 'torn_grenade_order'
    };

    // ==================== 全局变量 ====================
    let mainContainer = null;
    let titleBar = null;
    let contentArea = null;
    let titleStatusSpan = null;
    let titleSourceSpan = null;
    let separatorDiv = null;
    let boosterGridContainer = null;
    let grenadeGridContainer = null;
    let sortModeBar = null;
    let monitorInterval = null;
    let tabObserver = null;
    let isMainEnabled = false;
    let isGrenadeEnabled = false;
    let menuCommandId = null;
    let menuGrenadeCommandId = null;
    let menuScaleDisplayId = null;

    // 排序模式相关
    let isSortMode = false;
    let originalButtonStyles = new Map();

    let boosterButtons = {};
    let grenadeButtons = {};
    let boosterOrderList = [];
    let grenadeOrderList = [];

    let currentScale = 1;
    let isDesktop = false;
    let userDefinedScale = null;
    let isApplyingScale = false;

    let isDragging = false;
    let dragStartX = 0, dragStartY = 0;
    let panelStartLeft = 0, panelStartTop = 0;
    let dragStarted = false;
    let dragThreshold = 5;

    let equipLock = false;
    let monitorRunning = false;

    // 长按检测相关
    let longPressTimer = null;
    let isLongPressTriggered = false;
    let longPressStartX = 0, longPressStartY = 0;

    // ==================== 顺序管理 ====================

    function loadOrderFromStorage() {
        const savedBoosterOrder = GM_getValue(STORAGE_KEYS.BOOSTER_ORDER, null);
        if (savedBoosterOrder && Array.isArray(savedBoosterOrder) && savedBoosterOrder.length === BOOSTER_LIST.length) {
            boosterOrderList = savedBoosterOrder;
        } else {
            boosterOrderList = BOOSTER_LIST.map(b => b.id);
        }

        const savedGrenadeOrder = GM_getValue(STORAGE_KEYS.GRENADE_ORDER, null);
        if (savedGrenadeOrder && Array.isArray(savedGrenadeOrder) && savedGrenadeOrder.length === GRENADE_LIST.length) {
            grenadeOrderList = savedGrenadeOrder;
        } else {
            grenadeOrderList = GRENADE_LIST.map(g => g.id);
        }
    }

    function saveBoosterOrder(orderList) {
        boosterOrderList = orderList;
        GM_setValue(STORAGE_KEYS.BOOSTER_ORDER, orderList);
    }

    function saveGrenadeOrder(orderList) {
        grenadeOrderList = orderList;
        GM_setValue(STORAGE_KEYS.GRENADE_ORDER, orderList);
    }

    function getSortedBoosters() {
        const boosterMap = {};
        BOOSTER_LIST.forEach(b => { boosterMap[b.id] = b; });
        return boosterOrderList.map(id => boosterMap[id]).filter(b => b);
    }

    function getSortedGrenades() {
        const grenadeMap = {};
        GRENADE_LIST.forEach(g => { grenadeMap[g.id] = g; });
        return grenadeOrderList.map(id => grenadeMap[id]).filter(g => g);
    }

    // ==================== 辅助函数 ====================

    function isTemporaryTabActive() {
        const tempTabLi = document.querySelector('#categoriesList li[data-type="Temporary"]');
        if (!tempTabLi) return false;
        return tempTabLi.classList.contains('ui-tabs-active') ||
            tempTabLi.classList.contains('ui-state-active') ||
            tempTabLi.classList.contains('active');
    }

    function isFactionItem(item) {
        if (!item || !item.querySelector) return false;
        if (item.querySelector('[data-action="return"]')) return true;
        if (item.querySelector('.option-return-to-faction')) return true;
        const btns = item.querySelectorAll('button, [role="button"]');
        for (const btn of btns) {
            const aria = btn.getAttribute('aria-label') || '';
            if (aria.includes('Return') || aria.includes('return')) return true;
        }
        return false;
    }

    function isPersonalItem(item) {
        if (!item || !item.querySelector) return false;
        if (item.querySelector('[data-action="send"]')) return true;
        if (item.querySelector('.option-send')) return true;
        const btns = item.querySelectorAll('button, [role="button"]');
        for (const btn of btns) {
            const aria = btn.getAttribute('aria-label') || '';
            if (aria.includes('Send')) return true;
        }
        return false;
    }

    function getItemTypeFromItem(item) {
        if (!item) return null;
        const itemId = item.getAttribute('data-item');
        if (itemId && BOOSTER_CONFIG[itemId]) return BOOSTER_CONFIG[itemId];
        if (itemId && GRENADE_CONFIG[itemId]) return GRENADE_CONFIG[itemId];

        const img = item.querySelector('img.torn-item');
        if (img && img.alt) {
            for (const config of ALL_ITEMS) {
                if (img.alt === config.name) return config;
            }
        }

        const nameSpan = item.querySelector('.name');
        if (nameSpan) {
            const name = nameSpan.textContent.trim();
            for (const config of ALL_ITEMS) {
                if (name === config.name) return config;
            }
        }
        return null;
    }

    function isItemEquipped(item) {
        if (!item) return false;
        const unequipSpan = item.querySelector('span.icon-h.unequip');
        if (unequipSpan) return true;

        const elements = item.querySelectorAll('span, button, [role="button"]');
        for (const el of elements) {
            const text = el.textContent ? el.textContent.trim() : '';
            if (text === 'Unequip') return true;
            const aria = el.getAttribute('aria-label') || '';
            if (aria === 'Unequip this Item' || aria.includes('Unequip')) return true;
        }

        if (item.querySelector('.option-unequip')) return true;
        return false;
    }

    function findEquippedItem() {
        const allItemIds = [...Object.keys(BOOSTER_CONFIG), ...Object.keys(GRENADE_CONFIG)];
        const selector = allItemIds.map(id => `li[data-item="${id}"]`).join(', ');
        const allItems = document.querySelectorAll(selector);

        for (const item of allItems) {
            if (isItemEquipped(item)) {
                const itemConfig = getItemTypeFromItem(item);
                if (!itemConfig) continue;

                let source = 'unknown';
                if (isFactionItem(item)) {
                    source = 'faction';
                } else if (isPersonalItem(item)) {
                    source = 'own';
                }

                return { item: itemConfig, source, itemElement: item };
            }
        }
        return null;
    }

    function getEquippedItemId() {
        const equipped = findEquippedItem();
        return equipped ? equipped.item.id : null;
    }

    function updateButtonsDisabledState(forceRefresh = false) {
        const updateFn = () => {
            const equippedId = getEquippedItemId();

            for (const [itemId, btn] of Object.entries(boosterButtons)) {
                if (!btn || !btn.isConnected) continue;
                const isEquipped = (parseInt(itemId) === equippedId);
                const itemConfig = BOOSTER_CONFIG[itemId];

                if (isEquipped) {
                    btn.disabled = true;
                    btn.style.filter = 'grayscale(100%)';
                    btn.style.opacity = '0.6';
                    btn.style.cursor = 'not-allowed';
                    btn.title = `已装备${itemConfig.fullName}`;
                } else if (!isSortMode) {
                    btn.disabled = false;
                    btn.style.filter = '';
                    btn.style.opacity = '';
                    btn.style.cursor = 'pointer';
                    btn.title = `装备 ${itemConfig.fullName}`;
                }
            }

            for (const [itemId, btn] of Object.entries(grenadeButtons)) {
                if (!btn || !btn.isConnected) continue;
                const isEquipped = (parseInt(itemId) === equippedId);
                const itemConfig = GRENADE_CONFIG[itemId];

                if (isEquipped) {
                    btn.disabled = true;
                    btn.style.filter = 'grayscale(100%)';
                    btn.style.opacity = '0.6';
                    btn.style.cursor = 'not-allowed';
                    btn.title = `已装备${itemConfig.fullName}`;
                } else if (!isSortMode) {
                    btn.disabled = false;
                    btn.style.filter = '';
                    btn.style.opacity = '';
                    btn.style.cursor = 'pointer';
                    btn.title = `装备 ${itemConfig.fullName}`;
                }
            }
        };

        if (forceRefresh) {
            requestAnimationFrame(updateFn);
        } else {
            updateFn();
        }
    }

    function updateTitleDisplay() {
        if (!titleStatusSpan || !titleSourceSpan) return;
        if (!titleStatusSpan.isConnected || !titleSourceSpan.isConnected) return;

        const equipped = findEquippedItem();

        if (equipped) {
            titleStatusSpan.innerHTML = equipped.item.fullName;
            titleStatusSpan.style.color = '#e74c3c';
            titleStatusSpan.style.fontWeight = 'bold';

            if (equipped.source === 'faction') {
                titleSourceSpan.innerHTML = '（帮派）';
                titleSourceSpan.style.color = '#2ecc71';
            } else if (equipped.source === 'own') {
                titleSourceSpan.innerHTML = '（个人）';
                titleSourceSpan.style.color = '#f39c12';
            } else {
                titleSourceSpan.innerHTML = '';
            }
        } else {
            titleStatusSpan.innerHTML = '检测中...';
            titleStatusSpan.style.color = '#888';
            titleStatusSpan.style.fontWeight = 'normal';
            titleSourceSpan.innerHTML = '';
        }

        checkAndScaleTitleText();
        updateButtonsDisabledState(false);
    }

    function checkAndScaleTitleText() {
        if (!titleBar) return;
        const baseFontSize = 13 * currentScale;
        const originalWhiteSpace = titleBar.style.whiteSpace;
        titleBar.style.whiteSpace = 'nowrap';

        if (titleBar.scrollWidth > titleBar.clientWidth) {
            let minFontSize = baseFontSize * 0.5;
            let low = minFontSize;
            let high = baseFontSize;

            for (let i = 0; i < 10; i++) {
                const testSize = (low + high) / 2;
                titleBar.style.fontSize = testSize + 'px';
                if (titleBar.scrollWidth <= titleBar.clientWidth) {
                    low = testSize;
                } else {
                    high = testSize;
                }
            }
            titleBar.style.fontSize = low + 'px';
        } else {
            titleBar.style.fontSize = baseFontSize + 'px';
        }

        titleBar.style.whiteSpace = originalWhiteSpace;
    }

    function getEquipButtonForItem(itemId, itemConfig) {
        const items = document.querySelectorAll(`li[data-item="${itemId}"]`);
        if (items.length === 0) return null;

        function findEquipBtn(item) {
            const equipSpan = item.querySelector('span.icon-h.equip');
            if (equipSpan) {
                const btn = equipSpan.querySelector('button');
                if (btn) return btn;
                if (equipSpan.getAttribute('role') === 'button') return equipSpan;
            }

            let btn = item.querySelector('.option-equip');
            if (!btn) btn = item.querySelector('[data-action="equip"] button');
            if (!btn) btn = item.querySelector('button[aria-label*="Equip"]');

            if (!btn) {
                const btns = item.querySelectorAll('button, [role="button"]');
                for (const b of btns) {
                    const text = b.textContent ? b.textContent.trim() : '';
                    const aria = b.getAttribute('aria-label') || '';
                    if (text === 'Equip' || aria.includes('Equip')) {
                        btn = b;
                        break;
                    }
                }
            }
            return btn;
        }

        for (const item of items) {
            const equipBtn = findEquipBtn(item);
            if (equipBtn && isFactionItem(item)) {
                return { equipBtn, source: 'faction', item: item };
            }
        }

        for (const item of items) {
            const equipBtn = findEquipBtn(item);
            if (equipBtn && isPersonalItem(item)) {
                return { equipBtn, source: 'own', item: item };
            }
        }

        return null;
    }

    function isItemEquippedById(itemId) {
        const items = document.querySelectorAll(`li[data-item="${itemId}"]`);
        for (const item of items) {
            if (isItemEquipped(item)) return true;
        }
        return false;
    }

    // ==================== 失败消息处理 ====================

    function formatErrorMessage(originalMessage) {
        const underAttackMessage = "You cannot equip this item because you are under attack.";
        if (originalMessage === underAttackMessage) {
            return "正在被攻击，无法切换";
        }
        if (originalMessage.startsWith("You cannot equip")) {
            return `无法装备物品，原因为：${originalMessage}`;
        }
        return originalMessage;
    }

    // ==================== 装备成功消息检测 ====================

    async function waitForEquipSuccessMessage(itemName, itemElement) {
        const maxAttempts = Math.ceil(CONFIG.EQUIP_TIMEOUT / 200);
        const intervalMs = 200;
        let attempts = 0;

        while (attempts < maxAttempts) {
            if (!itemElement.isConnected) {
                return { success: false, message: '元素已从DOM移除，切换可能已成功' };
            }

            const actionWrap = itemElement.querySelector('.action-wrap.equipped-act');

            if (actionWrap) {
                const display = window.getComputedStyle(actionWrap).display;
                if (display === 'block') {
                    const messageText = actionWrap.textContent.trim();
                    const expectedMessage = `You equipped your ${itemName}.`;

                    if (messageText === expectedMessage) {
                        return { success: true };
                    } else {
                        return { success: false, message: formatErrorMessage(messageText), rawMessage: messageText };
                    }
                }
            }

            await new Promise(r => setTimeout(r, intervalMs));
            attempts++;
        }
        return { success: false, message: '切换超时，请检查网络' };
    }

    // ==================== 中央通知 ====================

    let centralNotification = null;
    let centralNotificationTimeout = null;

    function clearNotificationTimeout() {
        if (centralNotificationTimeout) {
            clearTimeout(centralNotificationTimeout);
            centralNotificationTimeout = null;
        }
    }

    function showCentralNotification(message, isError = false, isWarning = false, isPersistent = false, duration = 2000, isPersonal = false, isFaction = false) {
        if (!centralNotification) {
            centralNotification = document.createElement('div');
            centralNotification.id = 'torn-central-notification';
            centralNotification.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                z-index: 10002;
                background: #2e7d32;
                color: white;
                padding: 12px 24px;
                border-radius: 8px;
                font-size: 16px;
                font-weight: bold;
                font-family: Arial, sans-serif;
                text-align: center;
                box-shadow: 0 4px 15px rgba(0,0,0,0.3);
                transition: opacity 0.3s;
                opacity: 0;
                pointer-events: none;
                white-space: normal;
                max-width: 90%;
                word-break: break-word;
            `;
            document.body.appendChild(centralNotification);
        }

        clearNotificationTimeout();

        if (isPersonal && !isError && !isWarning) {
            centralNotification.style.backgroundColor = '#2980b9';
        } else if (isFaction && !isError && !isWarning) {
            centralNotification.style.backgroundColor = '#2e7d32';
        } else if (isWarning) {
            centralNotification.style.backgroundColor = '#f39c12';
        } else if (isError) {
            centralNotification.style.backgroundColor = '#c62828';
        } else {
            centralNotification.style.backgroundColor = '#2e7d32';
        }

        centralNotification.textContent = message;
        centralNotification.style.opacity = '1';

        if (!isPersistent) {
            centralNotificationTimeout = setTimeout(() => {
                if (centralNotification) centralNotification.style.opacity = '0';
            }, duration);
        }
    }

    // ==================== 装备处理函数 ====================

    async function handleEquipItem(itemConfig) {
        if (equipLock) {
            showCentralNotification('正在执行装备操作，请稍候...', false, true);
            return;
        }

        if (isSortMode) {
            return;
        }

        if (itemConfig.category === 'booster' && !isMainEnabled) {
            showCentralNotification('脚本总开关已关闭，请通过油猴菜单开启', false, true);
            return;
        }
        if (itemConfig.category === 'grenade' && (!isMainEnabled || !isGrenadeEnabled)) {
            showCentralNotification('手雷切换功能未开启，请通过油猴菜单开启', false, true);
            return;
        }

        if (isItemEquippedById(itemConfig.id)) {
            showCentralNotification(`已经装备了${itemConfig.fullName}`, false, true);
            updateTitleDisplay();
            return;
        }

        equipLock = true;

        try {
            const result = getEquipButtonForItem(itemConfig.id, itemConfig);

            if (!result) {
                showCentralNotification(`未找到可用的 ${itemConfig.fullName}`, true);
                equipLock = false;
                return;
            }

            const { equipBtn, source, item: itemElement } = result;
            const sourceText = source === 'faction' ? '帮派' : '个人';
            const isFaction = (source === 'faction');
            const isPersonal = (source === 'own');

            if (equipBtn) {
                const scrollY = window.pageYOffset || document.documentElement.scrollTop;
                equipBtn.click();

                const waitResult = await waitForEquipSuccessMessage(itemConfig.name, itemElement);

                if (waitResult.success) {
                    showCentralNotification(`切换${itemConfig.fullName}成功 ${sourceText}`, false, false, false, 2000, isPersonal, isFaction);
                    requestAnimationFrame(() => {
                        window.scrollTo({ top: scrollY, behavior: 'instant' });
                        updateTitleDisplay();
                        updateButtonsDisabledState(true);
                        equipLock = false;
                    });
                } else {
                    showCentralNotification(waitResult.message, true, false, true, 5000);
                    setTimeout(() => {
                        window.scrollTo({ top: scrollY, behavior: 'instant' });
                        updateTitleDisplay();
                    }, 200);
                    equipLock = false;
                }
            } else {
                showCentralNotification(`找到 ${itemConfig.fullName} 但未找到装备按钮`, true);
                equipLock = false;
            }
        } catch (error) {
            console.error('[装备助手] 装备操作异常:', error);
            showCentralNotification('装备操作出现异常，请刷新页面重试', true, false, true, 5000);
            equipLock = false;
        }
    }

    // ==================== 排序模式 ====================

    function applySortModeStyles() {
        const allButtons = mainContainer.querySelectorAll('.item-btn');
        const sortScale = CONFIG.SORT_MODE_BUTTON_SCALE;

        allButtons.forEach(btn => {
            const originalFontSize = parseInt(btn.style.fontSize);

            if (!originalButtonStyles.has(btn)) {
                originalButtonStyles.set(btn, {
                    fontSize: btn.style.fontSize,
                    padding: btn.style.padding,
                    transform: btn.style.transform,
                    transition: btn.style.transition
                });
            }

            btn.style.fontSize = (originalFontSize * sortScale) + 'px';
            btn.style.padding = `${6 * currentScale * sortScale}px ${10 * currentScale * sortScale}px`;
            btn.style.cursor = 'grab';
            btn.style.transition = 'all 0.2s';
        });

        if (boosterGridContainer) {
            boosterGridContainer.style.gap = `${6 * currentScale}px`;
        }
        if (grenadeGridContainer) {
            grenadeGridContainer.style.gap = `${6 * currentScale}px`;
        }
    }

    function restoreSortModeStyles() {
        for (const [btn, styles] of originalButtonStyles) {
            if (btn && btn.isConnected) {
                btn.style.fontSize = styles.fontSize;
                btn.style.padding = styles.padding;
                btn.style.cursor = 'pointer';
                btn.style.transform = '';
                btn.style.transition = styles.transition || 'all 0.2s';
            }
        }
        originalButtonStyles.clear();

        if (boosterGridContainer) {
            boosterGridContainer.style.gap = `${8 * currentScale}px`;
        }
        if (grenadeGridContainer) {
            grenadeGridContainer.style.gap = `${8 * currentScale}px`;
        }
    }

    function addShakeAnimation(element) {
        element.style.animation = 'torn-shake 0.5s ease-in-out infinite';
        if (!document.querySelector('#torn-shake-keyframes')) {
            const style = document.createElement('style');
            style.id = 'torn-shake-keyframes';
            style.textContent = `
                @keyframes torn-shake {
                    0%, 100% { transform: translateX(0); }
                    25% { transform: translateX(-2px); }
                    75% { transform: translateX(2px); }
                }
            `;
            document.head.appendChild(style);
        }
    }

    function removeShakeAnimation(element) {
        element.style.animation = '';
    }

    function createSortModeBar() {
        if (sortModeBar && sortModeBar.isConnected) return;

        sortModeBar = document.createElement('div');
        sortModeBar.id = 'torn-sort-mode-bar';
        sortModeBar.style.cssText = `
            background: linear-gradient(135deg, #e74c3c, #c0392b);
            color: white;
            padding: 6px 10px;
            border-radius: 6px;
            margin-bottom: 8px;
            font-size: ${11 * currentScale}px;
            font-weight: bold;
            text-align: center;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 8px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.2);
        `;

        const textSpan = document.createElement('span');
        textSpan.innerHTML = '🔧 拖拽按钮调整顺序';
        textSpan.style.flex = '1';
        textSpan.style.fontSize = `${11 * currentScale}px`;

        const doneBtn = document.createElement('button');
        doneBtn.textContent = '✓';
        doneBtn.style.cssText = `
            background: rgba(255,255,255,0.2);
            border: 1px solid rgba(255,255,255,0.5);
            border-radius: 4px;
            padding: 2px 8px;
            color: white;
            font-weight: bold;
            cursor: pointer;
            font-size: ${12 * currentScale}px;
            transition: all 0.2s;
            min-width: 32px;
        `;
        doneBtn.addEventListener('mouseenter', () => {
            doneBtn.style.background = 'rgba(255,255,255,0.3)';
        });
        doneBtn.addEventListener('mouseleave', () => {
            doneBtn.style.background = 'rgba(255,255,255,0.2)';
        });
        doneBtn.addEventListener('click', exitSortMode);

        sortModeBar.appendChild(textSpan);
        sortModeBar.appendChild(doneBtn);

        if (contentArea && !sortModeBar.isConnected) {
            contentArea.insertBefore(sortModeBar, contentArea.firstChild);
        }
    }

    function removeSortModeBar() {
        if (sortModeBar && sortModeBar.isConnected) {
            sortModeBar.remove();
        }
        sortModeBar = null;
    }

    function enterSortMode() {
        if (isSortMode) return;
        if (!isMainEnabled) {
            showCentralNotification('请先开启脚本总开关', false, true);
            return;
        }

        isSortMode = true;

        createSortModeBar();
        applySortModeStyles();

        Object.values(boosterButtons).forEach(btn => {
            if (btn && btn.isConnected && !btn.disabled) {
                addShakeAnimation(btn);
                btn.style.boxShadow = '0 0 0 2px rgba(255,255,255,0.3), 0 2px 4px rgba(0,0,0,0.2)';
            }
        });
        Object.values(grenadeButtons).forEach(btn => {
            if (btn && btn.isConnected && !btn.disabled) {
                addShakeAnimation(btn);
                btn.style.boxShadow = '0 0 0 2px rgba(255,255,255,0.3), 0 2px 4px rgba(0,0,0,0.2)';
            }
        });

        updateButtonsDisabledState(false);
        showCentralNotification('已进入排序模式，拖拽按钮调整顺序', false, false, false, 1500);
    }

    function exitSortMode() {
        if (!isSortMode) return;

        isSortMode = false;

        removeSortModeBar();
        restoreSortModeStyles();

        Object.values(boosterButtons).forEach(btn => {
            if (btn && btn.isConnected) {
                removeShakeAnimation(btn);
                btn.style.boxShadow = '';
            }
        });
        Object.values(grenadeButtons).forEach(btn => {
            if (btn && btn.isConnected) {
                removeShakeAnimation(btn);
                btn.style.boxShadow = '';
            }
        });

        updateButtonsDisabledState(false);
        showCentralNotification('已退出排序模式', false, false, false, 1000);
    }

    function getButtonListFromContainer(container) {
        if (!container) return [];
        return Array.from(container.children).filter(child =>
            child.classList && child.classList.contains('item-btn')
        );
    }

    function reorderButtons(fromIndex, toIndex, isBooster) {
        if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;

        if (isBooster) {
            const newOrder = [...boosterOrderList];
            const [movedId] = newOrder.splice(fromIndex, 1);
            newOrder.splice(toIndex, 0, movedId);
            saveBoosterOrder(newOrder);
            renderBoosterButtons();
        } else {
            const newOrder = [...grenadeOrderList];
            const [movedId] = newOrder.splice(fromIndex, 1);
            newOrder.splice(toIndex, 0, movedId);
            saveGrenadeOrder(newOrder);
            renderGrenadeButtons();
        }
    }

    // ==================== 拖拽排序实现（PC + 手机统一，修复残影问题） ====================

    function initDragSortForContainer(container, isBooster) {
        if (!container) return;

        // 每个容器独立的拖拽状态
        let dragState = {
            active: false,
            dragItem: null,
            dragItemClone: null,
            dragStartIndex: -1,
            startX: 0,
            startY: 0,
            isDragging: false
        };

        const getButtons = () => getButtonListFromContainer(container);

        // 清理克隆体的函数
        const clearClone = () => {
            if (dragState.dragItemClone && dragState.dragItemClone.parentNode) {
                dragState.dragItemClone.remove();
            }
            dragState.dragItemClone = null;
            if (dragState.dragItem) {
                dragState.dragItem.style.opacity = '';
            }
        };

        const createClone = (original, clientX, clientY) => {
            // 先清理已有的克隆体
            clearClone();

            const rect = original.getBoundingClientRect();
            const clone = original.cloneNode(true);
            clone.style.position = 'fixed';
            clone.style.left = (clientX - rect.width / 2) + 'px';
            clone.style.top = (clientY - rect.height / 2) + 'px';
            clone.style.width = rect.width + 'px';
            clone.style.margin = '0';
            clone.style.opacity = '0.85';
            clone.style.zIndex = '10001';
            clone.style.pointerEvents = 'none';
            clone.style.transform = 'scale(1.05)';
            clone.style.transition = 'none';
            clone.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';
            document.body.appendChild(clone);
            return clone;
        };

        const handleStart = (clientX, clientY, target) => {
            if (!isSortMode) return false;
            const btn = target.closest('.item-btn');
            if (!btn) return false;
            if (dragState.active) return false;

            dragState.active = true;
            dragState.dragItem = btn;
            const buttons = getButtons();
            dragState.dragStartIndex = buttons.indexOf(dragState.dragItem);
            dragState.startX = clientX;
            dragState.startY = clientY;
            dragState.isDragging = false;

            // 设置原始按钮半透明
            dragState.dragItem.style.opacity = '0.4';
            return true;
        };

        const handleMove = (clientX, clientY) => {
            if (!dragState.active || !dragState.dragItem) return;

            const deltaX = Math.abs(clientX - dragState.startX);
            const deltaY = Math.abs(clientY - dragState.startY);

            if (!dragState.isDragging && (deltaX > 8 || deltaY > 8)) {
                dragState.isDragging = true;
                dragState.dragItemClone = createClone(dragState.dragItem, clientX, clientY);
            }

            if (dragState.isDragging && dragState.dragItemClone) {
                dragState.dragItemClone.style.left = (clientX - dragState.dragItemClone.offsetWidth / 2) + 'px';
                dragState.dragItemClone.style.top = (clientY - dragState.dragItemClone.offsetHeight / 2) + 'px';

                const elementsAtCursor = document.elementsFromPoint(clientX, clientY);
                for (const el of elementsAtCursor) {
                    const targetBtn = el.closest('.item-btn');
                    if (targetBtn && targetBtn !== dragState.dragItem && targetBtn.parentNode === container) {
                        const currentButtons = getButtons();
                        const targetIndex = currentButtons.indexOf(targetBtn);
                        const currentDragIndex = currentButtons.indexOf(dragState.dragItem);
                        if (targetIndex !== -1 && targetIndex !== currentDragIndex && currentDragIndex !== -1) {
                            reorderButtons(currentDragIndex, targetIndex, isBooster);
                            // 重新获取引用（因为按钮被重新渲染了）
                            const newDragItem = document.querySelector(`#${dragState.dragItem.id}`);
                            if (newDragItem) {
                                dragState.dragItem = newDragItem;
                                dragState.dragItem.style.opacity = '0.4';
                            }
                        }
                        break;
                    }
                }
            }
        };

        const handleEnd = () => {
            // 清理克隆体和恢复样式
            clearClone();
            if (dragState.dragItem) {
                dragState.dragItem.style.opacity = '';
            }
            // 重置状态
            dragState.active = false;
            dragState.dragItem = null;
            dragState.isDragging = false;
            dragState.dragStartIndex = -1;
        };

        // PC 鼠标事件
        container.addEventListener('mousedown', (e) => {
            if (!isSortMode) return;
            e.preventDefault();
            if (handleStart(e.clientX, e.clientY, e.target)) {
                const onMouseMove = (moveEvent) => {
                    handleMove(moveEvent.clientX, moveEvent.clientY);
                };
                const onMouseUp = () => {
                    handleEnd();
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                };
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            }
        });

        // 手机触摸事件
        container.addEventListener('touchstart', (e) => {
            if (!isSortMode) return;
            e.preventDefault();
            const touch = e.touches[0];
            if (handleStart(touch.clientX, touch.clientY, e.target)) {
                const onTouchMove = (moveEvent) => {
                    moveEvent.preventDefault();
                    const touchMove = moveEvent.touches[0];
                    handleMove(touchMove.clientX, touchMove.clientY);
                };
                const onTouchEnd = () => {
                    handleEnd();
                    document.removeEventListener('touchmove', onTouchMove);
                    document.removeEventListener('touchend', onTouchEnd);
                };
                document.addEventListener('touchmove', onTouchMove, { passive: false });
                document.addEventListener('touchend', onTouchEnd);
            }
        });
    }

    // ==================== 长按进入排序模式（PC + 手机） ====================

    function initLongPressToEnterSortMode() {
        let pressTimer = null;
        let hasTriggered = false;
        let startX = 0, startY = 0;

        const cancelLongPress = () => {
            if (pressTimer) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
            hasTriggered = false;
        };

        const startLongPressTimer = (clientX, clientY, target) => {
            if (isSortMode) return;
            const btn = target.closest('.item-btn');
            if (!btn) return;
            if (btn.disabled) return;

            startX = clientX;
            startY = clientY;
            hasTriggered = false;

            pressTimer = setTimeout(() => {
                if (!hasTriggered && !isSortMode) {
                    hasTriggered = true;
                    enterSortMode();
                }
                pressTimer = null;
            }, CONFIG.LONG_PRESS_DURATION);
        };

        const checkMoveCancel = (clientX, clientY) => {
            if (pressTimer && !hasTriggered) {
                const deltaX = Math.abs(clientX - startX);
                const deltaY = Math.abs(clientY - startY);
                if (deltaX > 10 || deltaY > 10) {
                    cancelLongPress();
                }
            }
        };

        // PC 鼠标长按
        const handleMouseDown = (e) => {
            if (isSortMode) return;
            startLongPressTimer(e.clientX, e.clientY, e.target);

            const onMouseMove = (moveEvent) => {
                checkMoveCancel(moveEvent.clientX, moveEvent.clientY);
            };
            const onMouseUp = () => {
                cancelLongPress();
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };

        // 手机触摸长按
        const handleTouchStart = (e) => {
            if (isSortMode) return;
            const touch = e.touches[0];
            startLongPressTimer(touch.clientX, touch.clientY, e.target);

            const onTouchMove = (moveEvent) => {
                const touchMove = moveEvent.touches[0];
                checkMoveCancel(touchMove.clientX, touchMove.clientY);
            };
            const onTouchEnd = () => {
                cancelLongPress();
                document.removeEventListener('touchmove', onTouchMove);
                document.removeEventListener('touchend', onTouchEnd);
            };
            document.addEventListener('touchmove', onTouchMove);
            document.addEventListener('touchend', onTouchEnd);
        };

        if (boosterGridContainer) {
            boosterGridContainer.addEventListener('mousedown', handleMouseDown);
            boosterGridContainer.addEventListener('touchstart', handleTouchStart, { passive: false });
        }
        if (grenadeGridContainer) {
            grenadeGridContainer.addEventListener('mousedown', handleMouseDown);
            grenadeGridContainer.addEventListener('touchstart', handleTouchStart, { passive: false });
        }
    }

    // ==================== 渲染按钮 ====================

    function renderBoosterButtons() {
        if (!boosterGridContainer) return;

        boosterGridContainer.innerHTML = '';
        boosterButtons = {};

        const sortedBoosters = getSortedBoosters();

        sortedBoosters.forEach(booster => {
            const btn = document.createElement('button');
            btn.textContent = booster.displayName;
            btn.className = 'item-btn booster-btn';
            btn.id = `booster-btn-${booster.id}`;
            btn.style.cssText = `
                padding: ${8 * currentScale}px ${12 * currentScale}px;
                border: none;
                border-radius: 8px;
                background-color: ${booster.color};
                color: white;
                font-size: ${14 * currentScale}px;
                font-weight: bold;
                cursor: pointer;
                transition: all 0.2s;
                box-shadow: 0 2px 6px rgba(0,0,0,0.2);
                white-space: nowrap;
                -webkit-tap-highlight-color: transparent;
            `;
            btn.title = `装备 ${booster.fullName}`;

            const handleClick = async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (btn.disabled || equipLock || isSortMode) return;
                await handleEquipItem(booster);
            };

            btn.addEventListener('click', handleClick);
            btn.addEventListener('mouseenter', () => {
                if (!btn.disabled && !equipLock && !isSortMode) {
                    btn.style.transform = 'scale(1.02)';
                    btn.style.boxShadow = '0 4px 10px rgba(0,0,0,0.3)';
                }
            });
            btn.addEventListener('mouseleave', () => {
                if (!isSortMode) {
                    btn.style.transform = 'scale(1)';
                }
                btn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)';
            });

            boosterGridContainer.appendChild(btn);
            boosterButtons[booster.id] = btn;
        });

        initDragSortForContainer(boosterGridContainer, true);
    }

    function renderGrenadeButtons() {
        if (!grenadeGridContainer) return;

        grenadeGridContainer.innerHTML = '';
        grenadeButtons = {};

        const sortedGrenades = getSortedGrenades();

        sortedGrenades.forEach(grenade => {
            const btn = document.createElement('button');
            btn.textContent = grenade.displayName;
            btn.className = 'item-btn grenade-btn';
            btn.id = `grenade-btn-${grenade.id}`;
            btn.style.cssText = `
                padding: ${8 * currentScale}px ${12 * currentScale}px;
                border: none;
                border-radius: 8px;
                background-color: ${grenade.color};
                color: white;
                font-size: ${14 * currentScale}px;
                font-weight: bold;
                cursor: pointer;
                transition: all 0.2s;
                box-shadow: 0 2px 6px rgba(0,0,0,0.2);
                white-space: nowrap;
                -webkit-tap-highlight-color: transparent;
            `;
            btn.title = `装备 ${grenade.fullName}`;

            const handleClick = async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (btn.disabled || equipLock || isSortMode) return;
                await handleEquipItem(grenade);
            };

            btn.addEventListener('click', handleClick);
            btn.addEventListener('mouseenter', () => {
                if (!btn.disabled && !equipLock && !isSortMode) {
                    btn.style.transform = 'scale(1.02)';
                    btn.style.boxShadow = '0 4px 10px rgba(0,0,0,0.3)';
                }
            });
            btn.addEventListener('mouseleave', () => {
                if (!isSortMode) {
                    btn.style.transform = 'scale(1)';
                }
                btn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)';
            });

            grenadeGridContainer.appendChild(btn);
            grenadeButtons[grenade.id] = btn;
        });

        initDragSortForContainer(grenadeGridContainer, false);
    }

    // ==================== 退出排序模式监听 ====================

    function setupExitSortModeListeners() {
        document.addEventListener('click', (e) => {
            if (!isSortMode) return;
            if (mainContainer && !mainContainer.contains(e.target)) {
                exitSortMode();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (!isSortMode) return;
            if (e.key === 'Escape') {
                exitSortMode();
            }
        });
    }

    // ==================== 缩放功能 ====================

    function getDefaultScale() {
        const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        isDesktop = !isMobileDevice;
        return isDesktop ? CONFIG.DESKTOP_DEFAULT_SCALE : CONFIG.MOBILE_DEFAULT_SCALE;
    }

    function loadScaleFromStorage() {
        const savedScale = GM_getValue('torn_booster_scale', null);
        if (savedScale !== null && typeof savedScale === 'number') {
            userDefinedScale = savedScale;
            currentScale = Math.min(CONFIG.MAX_SCALE, Math.max(CONFIG.MIN_SCALE, savedScale));
        } else {
            userDefinedScale = null;
            currentScale = getDefaultScale();
        }
        return currentScale;
    }

    function saveScaleToStorage(scale) {
        userDefinedScale = scale;
        GM_setValue('torn_booster_scale', scale);
        currentScale = scale;
    }

    function clampScale(value) {
        return Math.min(CONFIG.MAX_SCALE, Math.max(CONFIG.MIN_SCALE, value));
    }

    function promptScaleInput() {
        const defaultInput = currentScale.toFixed(1);
        const input = prompt(`请输入缩放倍率 (${CONFIG.MIN_SCALE} ~ ${CONFIG.MAX_SCALE})`, defaultInput);

        if (input === null) return;

        let newScale = parseFloat(input);

        if (isNaN(newScale)) {
            showCentralNotification(`请输入有效的数字 (${CONFIG.MIN_SCALE} ~ ${CONFIG.MAX_SCALE})`, true, false, false, 2000);
            return;
        }

        newScale = Math.round(newScale * 10) / 10;
        newScale = clampScale(newScale);

        saveScaleToStorage(newScale);
        applyScaleToPanel();
        refreshAllMenuCommands();
        showCentralNotification(`缩放倍率已设置为 ${currentScale.toFixed(1)}x`, false, false, false, 1200);
    }

    function refreshAllMenuCommands() {
        if (menuCommandId !== null) {
            GM_unregisterMenuCommand(menuCommandId);
            menuCommandId = null;
        }
        if (menuGrenadeCommandId !== null) {
            GM_unregisterMenuCommand(menuGrenadeCommandId);
            menuGrenadeCommandId = null;
        }
        if (menuScaleDisplayId !== null) {
            GM_unregisterMenuCommand(menuScaleDisplayId);
            menuScaleDisplayId = null;
        }

        const mainState = GM_getValue('torn_booster_switch', true);
        const mainText = mainState ? '[ON] 关闭脚本总开关' : '[OFF] 开启脚本总开关';
        menuCommandId = GM_registerMenuCommand(mainText, toggleMainFromMenu);

        const grenadeState = GM_getValue('torn_grenade_switch', false);
        const grenadeText = grenadeState ? '[ON] 关闭手雷切换' : '[OFF] 开启手雷切换';
        menuGrenadeCommandId = GM_registerMenuCommand(grenadeText, toggleGrenadeFromMenu);

        menuScaleDisplayId = GM_registerMenuCommand(`当前缩放倍率：${currentScale.toFixed(1)}x（点击输入倍率）`, promptScaleInput);
    }

    function applyScaleToPanel() {
        if (!mainContainer || isApplyingScale) return;
        isApplyingScale = true;

        const rect = mainContainer.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        const originalWidth = mainContainer.offsetWidth;
        const originalHeight = mainContainer.offsetHeight;

        mainContainer.style.transform = `scale(${currentScale})`;
        mainContainer.style.transformOrigin = 'top left';

        const scaledWidth = originalWidth * currentScale;
        const scaledHeight = originalHeight * currentScale;

        let newLeft = centerX - scaledWidth / 2;
        let newTop = centerY - scaledHeight / 2;

        mainContainer.style.left = newLeft + 'px';
        mainContainer.style.top = newTop + 'px';

        clampPanelPositionAndSave();
        applyInternalElementScale();

        isApplyingScale = false;
    }

    function clampPanelPositionAndSave() {
        if (!mainContainer) return;

        const rect = mainContainer.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;

        let currentLeft = parseFloat(mainContainer.style.left);
        let currentTop = parseFloat(mainContainer.style.top);

        if (isNaN(currentLeft)) currentLeft = 0;
        if (isNaN(currentTop)) currentTop = 0;

        let newLeft = currentLeft;
        let newTop = currentTop;
        let needsUpdate = false;

        if (currentLeft < 0) {
            newLeft = 0;
            needsUpdate = true;
        }
        if (currentLeft + width > window.innerWidth) {
            newLeft = window.innerWidth - width;
            needsUpdate = true;
        }
        if (currentTop < 0) {
            newTop = 0;
            needsUpdate = true;
        }
        if (currentTop + height > window.innerHeight) {
            newTop = window.innerHeight - height;
            needsUpdate = true;
        }

        if (needsUpdate) {
            mainContainer.style.left = newLeft + 'px';
            mainContainer.style.top = newTop + 'px';
        }

        savePanelPosition(newLeft, newTop);
    }

    function applyInternalElementScale() {
        if (!mainContainer) return;

        const buttons = mainContainer.querySelectorAll('.item-btn');
        const baseButtonFontSize = 14 * currentScale;
        const baseButtonPadding = `${8 * currentScale}px ${12 * currentScale}px`;

        buttons.forEach(btn => {
            if (!isSortMode) {
                btn.style.fontSize = baseButtonFontSize + 'px';
                btn.style.padding = baseButtonPadding;
            }
        });

        if (titleBar) {
            const baseTitleFontSize = 13 * currentScale;
            titleBar.style.fontSize = baseTitleFontSize + 'px';
            checkAndScaleTitleText();
        }

        if (boosterGridContainer && !isSortMode) {
            boosterGridContainer.style.gap = `${8 * currentScale}px`;
        }

        if (grenadeGridContainer && !isSortMode) {
            grenadeGridContainer.style.gap = `${8 * currentScale}px`;
        }

        if (separatorDiv) {
            separatorDiv.style.margin = `${8 * currentScale}px 0`;
        }

        if (sortModeBar) {
            sortModeBar.style.fontSize = `${11 * currentScale}px`;
            const textSpan = sortModeBar.querySelector('span');
            const doneBtn = sortModeBar.querySelector('button');
            if (textSpan) textSpan.style.fontSize = `${11 * currentScale}px`;
            if (doneBtn) doneBtn.style.fontSize = `${12 * currentScale}px`;
        }
    }

    function onWindowResize() {
        if (!mainContainer || mainContainer.style.display === 'none') return;
        clampPanelPositionAndSave();
    }

    // ==================== UI组件 ====================

    function startRealTimeMonitoring() {
        if (monitorInterval) clearInterval(monitorInterval);

        monitorInterval = setInterval(() => {
            if (monitorRunning) return;

            if (isMainEnabled && isTemporaryTabActive()) {
                monitorRunning = true;
                try {
                    updateTitleDisplay();
                } finally {
                    monitorRunning = false;
                }
            }
        }, CONFIG.MONITOR_INTERVAL);
    }

    function updatePanelVisibility() {
        if (!mainContainer) return;

        const tempTabActive = isTemporaryTabActive();

        if (isMainEnabled && tempTabActive) {
            mainContainer.style.display = 'block';
            setTimeout(() => {
                updateTitleDisplay();
                clampPanelPositionAndSave();
            }, 100);
        } else {
            mainContainer.style.display = 'none';
            if (isSortMode) {
                exitSortMode();
            }
        }
    }

    function updateGrenadeSectionVisibility() {
        if (!grenadeGridContainer || !separatorDiv) return;
        if (isGrenadeEnabled && isMainEnabled) {
            separatorDiv.style.display = 'block';
            grenadeGridContainer.style.display = 'grid';
        } else {
            separatorDiv.style.display = 'none';
            grenadeGridContainer.style.display = 'none';
        }
    }

    function startTabMonitoring() {
        const tabList = document.querySelector('#categoriesList');
        if (!tabList) {
            setTimeout(startTabMonitoring, 1000);
            return;
        }

        if (tabObserver) tabObserver.disconnect();

        tabObserver = new MutationObserver(() => {
            updatePanelVisibility();
        });

        tabObserver.observe(tabList, {
            attributes: true,
            attributeFilter: ['class'],
            subtree: true
        });
    }

    function loadSavedData() {
        isMainEnabled = GM_getValue('torn_booster_switch', true);
        isGrenadeEnabled = GM_getValue('torn_grenade_switch', false);
        loadScaleFromStorage();
        loadOrderFromStorage();
        return GM_getValue('torn_booster_panel_pos', null);
    }

    function saveMainSwitchState(enabled) {
        isMainEnabled = enabled;
        GM_setValue('torn_booster_switch', enabled);

        updateGrenadeSectionVisibility();
        updatePanelVisibility();

        refreshAllMenuCommands();

        if (!enabled && isSortMode) {
            exitSortMode();
        }

        if (isMainEnabled && isTemporaryTabActive()) {
            setTimeout(() => {
                updateTitleDisplay();
                clampPanelPositionAndSave();
            }, 100);
        }

        showCentralNotification(enabled ? '脚本总开关已开启' : '脚本总开关已关闭', false, true);
    }

    function saveGrenadeSwitchState(enabled) {
        isGrenadeEnabled = enabled;
        GM_setValue('torn_grenade_switch', enabled);

        updateGrenadeSectionVisibility();
        updatePanelVisibility();

        refreshAllMenuCommands();

        if (isMainEnabled && isGrenadeEnabled && isTemporaryTabActive()) {
            setTimeout(() => {
                updateTitleDisplay();
                clampPanelPositionAndSave();
            }, 100);
        }

        showCentralNotification(enabled ? '手雷切换功能已开启' : '手雷切换功能已关闭', false, true);
    }

    function savePanelPosition(left, top) {
        if (left !== undefined && top !== undefined && !isNaN(left) && !isNaN(top)) {
            GM_setValue('torn_booster_panel_pos', JSON.stringify({ left, top }));
        }
    }

    function toggleMainFromMenu() {
        const newState = !GM_getValue('torn_booster_switch', true);
        saveMainSwitchState(newState);
    }

    function toggleGrenadeFromMenu() {
        const newState = !GM_getValue('torn_grenade_switch', false);
        saveGrenadeSwitchState(newState);
    }

    // ==================== 面板拖拽 ====================

    function startDrag(e) {
        if (!titleBar || !titleBar.contains(e.target)) return;
        if (equipLock) return;
        if (isSortMode) return;

        e.preventDefault();
        if (e.touches) e.stopPropagation();
        isDragging = true;
        dragStarted = false;
        const coords = e.touches ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: e.clientX, y: e.clientY };
        const rect = mainContainer.getBoundingClientRect();
        dragStartX = coords.x - rect.left;
        dragStartY = coords.y - rect.top;
        panelStartLeft = rect.left;
        panelStartTop = rect.top;
        mainContainer.style.cursor = 'grabbing';
        mainContainer.style.transition = 'none';
        if (e.touches) {
            document.body.style.overflow = 'hidden';
            document.body.style.userSelect = 'none';
        }
    }

    function onDrag(e) {
        if (!isDragging) return;
        e.preventDefault();
        if (e.touches) e.stopPropagation();
        const coords = e.touches ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: e.clientX, y: e.clientY };
        if (!dragStarted) {
            const dx = Math.abs((coords.x - dragStartX) - panelStartLeft);
            const dy = Math.abs((coords.y - dragStartY) - panelStartTop);
            if (dx > dragThreshold || dy > dragThreshold) dragStarted = true;
        }
        if (!dragStarted) return;

        let newLeft = coords.x - dragStartX;
        let newTop = coords.y - dragStartY;

        const maxLeft = window.innerWidth - mainContainer.getBoundingClientRect().width;
        const maxTop = window.innerHeight - mainContainer.getBoundingClientRect().height;
        newLeft = Math.max(0, Math.min(maxLeft, newLeft));
        newTop = Math.max(0, Math.min(maxTop, newTop));

        mainContainer.style.left = newLeft + 'px';
        mainContainer.style.top = newTop + 'px';
        mainContainer.style.right = 'auto';
        mainContainer.style.bottom = 'auto';
    }

    function endDrag(e) {
        if (!isDragging) return;
        isDragging = false;
        mainContainer.style.cursor = 'default';
        mainContainer.style.transition = '';
        document.body.style.overflow = '';
        document.body.style.userSelect = '';
        if (dragStarted) {
            const rect = mainContainer.getBoundingClientRect();
            savePanelPosition(rect.left, rect.top);
        }
        setTimeout(() => { dragStarted = false; }, 100);
    }

    function setInitialPanelPosition(panel) {
        panel.style.left = 'auto';
        panel.style.right = '20px';
        panel.style.top = '100px';
        panel.style.bottom = 'auto';
        setTimeout(() => {
            const rect = panel.getBoundingClientRect();
            savePanelPosition(rect.left, rect.top);
        }, 100);
    }

    // ==================== 创建主面板 ====================

    function createMainPanel() {
        if (mainContainer) return;

        const savedPos = loadSavedData();

        mainContainer = document.createElement('div');
        mainContainer.id = 'torn-booster-panel';
        mainContainer.style.cssText = `
            position: fixed;
            z-index: 10000;
            display: none;
            background: rgba(30,30,35,0.95);
            backdrop-filter: blur(10px);
            border-radius: 12px;
            padding: 10px;
            min-width: 160px;
            box-shadow: 0 8px 20px rgba(0,0,0,0.3);
            font-family: Arial, sans-serif;
            transform-origin: top left;
        `;

        titleBar = document.createElement('div');
        titleBar.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 10px;
            padding-bottom: 6px;
            border-bottom: 1px solid rgba(255,255,255,0.2);
            cursor: grab;
            user-select: none;
            font-size: ${13 * currentScale}px;
            color: #ddd;
        `;
        titleBar.addEventListener('mousedown', startDrag);
        titleBar.addEventListener('touchstart', startDrag, { passive: false });

        const titlePrefix = document.createElement('span');
        titlePrefix.textContent = '当前装备：';
        titlePrefix.style.cssText = `color: #ddd;`;

        titleStatusSpan = document.createElement('span');
        titleStatusSpan.style.cssText = `margin-left: 4px;`;

        titleSourceSpan = document.createElement('span');

        titleBar.appendChild(titlePrefix);
        titleBar.appendChild(titleStatusSpan);
        titleBar.appendChild(titleSourceSpan);

        mainContainer.appendChild(titleBar);

        contentArea = document.createElement('div');
        contentArea.style.cssText = `display: block;`;

        boosterGridContainer = document.createElement('div');
        boosterGridContainer.className = 'booster-grid';
        boosterGridContainer.style.cssText = `display: grid; grid-template-columns: repeat(2, 1fr); gap: ${8 * currentScale}px;`;

        contentArea.appendChild(boosterGridContainer);

        separatorDiv = document.createElement('div');
        separatorDiv.style.cssText = `
            margin: ${8 * currentScale}px 0;
            height: 1px;
            background: linear-gradient(to right, transparent, rgba(255,255,255,0.3), transparent);
            display: none;
        `;
        contentArea.appendChild(separatorDiv);

        grenadeGridContainer = document.createElement('div');
        grenadeGridContainer.className = 'grenade-grid';
        grenadeGridContainer.style.cssText = `display: grid; grid-template-columns: repeat(2, 1fr); gap: ${8 * currentScale}px; display: none;`;

        contentArea.appendChild(grenadeGridContainer);
        mainContainer.appendChild(contentArea);

        renderBoosterButtons();
        renderGrenadeButtons();

        window.addEventListener('mousemove', onDrag);
        window.addEventListener('mouseup', endDrag);
        window.addEventListener('touchmove', onDrag, { passive: false });
        window.addEventListener('touchend', endDrag);
        window.addEventListener('touchcancel', endDrag);
        window.addEventListener('resize', () => onWindowResize());

        document.body.appendChild(mainContainer);

        if (savedPos) {
            try {
                const pos = JSON.parse(savedPos);
                mainContainer.style.left = pos.left + 'px';
                mainContainer.style.top = pos.top + 'px';
                mainContainer.style.right = 'auto';
                mainContainer.style.bottom = 'auto';
            } catch(e) {
                setInitialPanelPosition(mainContainer);
            }
        } else {
            setInitialPanelPosition(mainContainer);
        }

        mainContainer.style.transform = `scale(${currentScale})`;
        applyInternalElementScale();

        updateButtonsDisabledState();
        updateGrenadeSectionVisibility();
        updatePanelVisibility();

        setupExitSortModeListeners();
        initLongPressToEnterSortMode();
    }

    // ==================== 初始化 ====================
    let initialized = false;

    function init() {
        if (initialized) {
            console.log('[切针小助手] 已初始化，跳过重复初始化');
            return;
        }
        initialized = true;

        loadSavedData();
        refreshAllMenuCommands();
        createMainPanel();
        startTabMonitoring();
        startRealTimeMonitoring();
        console.log(`[切针小助手] v3.2 已启动 | 总开关: ${isMainEnabled ? '开' : '关'} | 手雷: ${isGrenadeEnabled ? '开' : '关'} | 缩放: ${currentScale.toFixed(1)}x`);
        console.log('[切针小助手] 拖拽排序: 长按按钮1秒进入排序模式，拖拽调整顺序，自动保存');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();