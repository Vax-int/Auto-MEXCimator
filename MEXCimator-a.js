(function () {
    // --- КОНСТАНТИ ТА СЕЛЕКТОРИ ---
    const SELECTORS = {
        ADD_MEXC_KEY_BTN_TEXT: 'Add MEXC Key', 
        SAVE_API_KEYS_BLOCK: '.save-api-keys', 
        TRADE_CARD: '.trade-card', 
        ARBITRAGE_INFO: '.arbitrage-info',
        TRADE_CARD_TITLE_STRONG: '.trade-details p strong', 
        PIN_BUTTON: '.pin-button',
        STOP_BUTTON: '.side-buttons .stop',
        START_BUTTON: '.side-buttons .start',
        CLEAR_BUTTON_TEXT: 'Clear', 
        CLEAR_PIN_BUTTON_FORM: 'form.new-trade-form', 
        NEW_RESTART_BUTTON_ID: 'restart-mexc-cards-btn', 
        DEFAULT_BUTTON_COLOR: '#007bff', 
        
        ALERT_TRIGGER_KEYWORD: 'key added successfully' 
    };
    
    const MAX_RETRIES = 3; 
    const RETRY_DELAY = 3000; 
    const MAX_WAIT_FOR_STATE = 15000; 
    
    // --- КРИТИЧНІ ПАУЗИ ---
    const SYNC_DELAY = 500;           
    const INTER_CLICK_DELAY = 1000;   
    const ADD_KEY_TIMEOUT = 15000; // 15 секунд на введення даних та отримання alert

    let isRestartProcessScheduled = false;
    let addKeyClickHappened = false; 
    let addKeyTimeoutId = null; // ЗМІНА 1: ID для тайм-ауту

    // Зберігаємо оригінальну функцію alert
    const originalAlert = window.alert; 

    // --- ДОПОМІЖНІ ФУНКЦІЇ ---
    function log(...args) { console.log('[MEXC Restart Script]', ...args); }
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    function findElementByText(selector, text, root = document) {
        const elements = root.querySelectorAll(selector);
        for (const el of elements) {
            if (el.textContent.trim() === text.trim()) { return el; }
        }
        return null;
    }
    function findCardByTitle(title) {
        const titleElements = document.querySelectorAll(SELECTORS.TRADE_CARD_TITLE_STRONG);
        for (const titleEl of titleElements) {
            if (titleEl.textContent.trim() === title.trim()) {
                return titleEl.closest(SELECTORS.TRADE_CARD);
            }
        }
        return null;
    }
    function findClearButton() {
         return findElementByText(SELECTORS.CLEAR_PIN_BUTTON_FORM + ' button', SELECTORS.CLEAR_BUTTON_TEXT);
    }
    
    // ... (решта допоміжних функцій clickWithWait, waitForButtonToBeEnabled, clickClear, handleRestartCard без змін) ...

    async function waitForButtonToBeEnabled(el, name, timeout) {
        if (!el) return false;
        if (!el.disabled) return true;
        const isEnabled = await new Promise(resolve => {
            const t0 = Date.now();
            const id = setInterval(() => {
                if (!el.disabled) { clearInterval(id); resolve(true); }
                if (Date.now() - t0 > timeout) { clearInterval(id); resolve(false); }
            }, 200);
        });
        if (isEnabled) {
            log(`   - Кнопка '${name}' стала доступною через ${(Date.now() - t0) / 1000}s.`);
            return true;
        } else {
            log(`❌ Помилка: Кнопка '${name}' не стала доступною за ${timeout/1000}с.`);
            return false;
        }
    }

    async function waitForButtonToChangeState(el, name, targetDisabledState, timeout) {
        return new Promise(resolve => {
            const t0 = Date.now();
            const id = setInterval(() => {
                if (el.disabled === targetDisabledState) { clearInterval(id); resolve(true); }
                if (Date.now() - t0 > timeout) { clearInterval(id); resolve(false); }
            }, 200);
        });
    }

    async function clickWithWait(el, name) {
        if (!el) return false;
        if (el.disabled) {
            const isEnabled = await waitForButtonToBeEnabled(el, name, 10000); 
            if (!isEnabled) return false;
        }
        el.click();
        log(`   - Натиснуто: ${name}`);

        if (name === 'Stop' || name === 'Start') {
            const isNowDisabled = await waitForButtonToChangeState(el, name + ' (disabled)', true, MAX_WAIT_FOR_STATE);
            if (isNowDisabled) {
                log(`   - ${name} виконано. Кнопка стала disabled.`);
            } else {
                log(`Помилка: Кнопка '${name}' не перейшла у стан disabled за 15с. Продовжуємо...`);
                return false; 
            }
        }
        if (name === 'Pin') { await sleep(INTER_CLICK_DELAY); }
        return true;
    }

    async function clickClear() {
        const clearBtn = findClearButton();
        if (!clearBtn) { log("❌ Не знайдено кнопку Clear. Пропуск."); return true; }
        clearBtn.click();
        log("   - Натиснуто: Clear.");
        return true;
    }

    async function handleRestartCard(title) {
        const getCardElements = (cardTitle) => {
             const currentCard = findCardByTitle(cardTitle); 
             if (!currentCard) return null;
             return {
                 pin: currentCard.querySelector(SELECTORS.PIN_BUTTON),
                 stopBtn: currentCard.querySelector(SELECTORS.STOP_BUTTON),
                 startBtn: currentCard.querySelector(SELECTORS.START_BUTTON),
                 clearBtn: findClearButton() 
             };
        };
        
        let elements = getCardElements(title);
        if (!elements || !elements.pin || !elements.stopBtn || !elements.startBtn) {
             log(`[Помилка] Пропуск картки ${title}. Не знайдено керуючих кнопок/активної картки.`);
             return;
        }
        log(`\n⚙️ Обробка картки: ${title}`);
        
        // 1. Pin
        if (!await clickWithWait(elements.pin, 'Pin')) return;
        elements = getCardElements(title); 
        if (!elements) return;
        
        // 2. Stop (з retry) 
        let stopSuccess = false;
        for (let i = 0; i < MAX_RETRIES; i++) {
            if (i > 0) log(`[Retry ${i}/${MAX_RETRIES - 1}] Повторна спроба зупинки...`);
            if (await clickWithWait(elements.stopBtn, 'Stop', 0)) { stopSuccess = true; break; }
            await sleep(RETRY_DELAY);
            elements = getCardElements(title); 
        }
        if (!stopSuccess) { log(`❌ Критична помилка: Не вдалося зупинити картку ${title} після ${MAX_RETRIES} спроб.`); }
        
        elements = getCardElements(title); 
        log("⏳ Stop виконано. Очікування, поки Start стане доступним...");
        const startNowEnabled = await waitForButtonToBeEnabled(elements.startBtn, 'Start (після Stop)', MAX_WAIT_FOR_STATE);
        if (!startNowEnabled) { log(`❌ Критична помилка: Кнопка 'Start' не стала доступною за ${MAX_WAIT_FOR_STATE / 1000}с після Stop.`); await clickClear(); return; }

        // 3. Start (з retry)
        let startSuccess = false;
        for (let i = 0; i < MAX_RETRIES; i++) {
            if (i > 0) log(`[Retry ${i}/${MAX_RETRIES - 1}] Повторна спроба запуску...`);
            if (await clickWithWait(elements.startBtn, 'Start', 0)) { startSuccess = true; break; }
            await sleep(RETRY_DELAY);
             elements = getCardElements(title); 
        }
        if (!startSuccess) { log(`❌ Критична помилка: Не вдалося запустити картку ${title} після ${MAX_RETRIES} спроб.`); }
        
        elements = getCardElements(title); 
        log("⏳ Start виконано. Очікування, поки Stop стане доступним...");
        const stopNowEnabled = await waitForButtonToBeEnabled(elements.stopBtn, 'Stop (після Start)', MAX_WAIT_FOR_STATE);
        if (!stopNowEnabled) { log(`❌ Критична помишка: Кнопка 'Stop' не стала доступною за ${MAX_WAIT_FOR_STATE / 1000}с після Start. Продовжуємо...`); }

        // 4. Clear
        await clickClear(); 
        
        if (stopSuccess && startSuccess) { log(`   - Картку ${title} перезапущено успішно.`); } 
        else { log(`   - Картку ${title} оброблено, але з помилками. Пін знято.`); }
        
        log(`⏳ Пауза ${SYNC_DELAY} мс для синхронізації перед наступною карткою.`);
        await sleep(SYNC_DELAY);
    }

    /**
     * Скидає прапор addKeyClickHappened, якщо alert не спрацював.
     */
    function resetAddKeyFlagAfterTimeout() {
        addKeyTimeoutId = setTimeout(() => {
            if (addKeyClickHappened) {
                log("⚠️ Тайм-аут (15с): Успішний alert не отримано. Скидаємо прапор 'очікування alert'.");
                addKeyClickHappened = false;
            }
            addKeyTimeoutId = null;
        }, ADD_KEY_TIMEOUT);
    }
    
    /**
     * Очищає встановлений тайм-аут.
     */
    function clearAddKeyTimeout() {
        if (addKeyTimeoutId) {
            clearTimeout(addKeyTimeoutId);
            addKeyTimeoutId = null;
        }
    }


    /**
     * Головна функція циклу (запускає перезапуск)
     */
    async function findMexcCardsAndRestart() {
        if (isRestartProcessScheduled) {
            log("⚠️ Процес перезапуску вже триває. Ігнорування повторного запуску.");
            return;
        }

        const restartBtn = document.getElementById(SELECTORS.NEW_RESTART_BUTTON_ID);
        
        // Керування станом кнопки під час роботи
        if (restartBtn) {
            restartBtn.style.backgroundColor = 'red';
            restartBtn.disabled = true;
            restartBtn.textContent = 'Restarting...';
        }

        isRestartProcessScheduled = true;
        
        log("🚀 Скрипт запущено: Пошук карток MEXC...");

        const allTradeCards = document.querySelectorAll(SELECTORS.TRADE_CARD);
        
        const mexcCardTitles = Array.from(allTradeCards).filter(card => {
            const info = card.querySelector(SELECTORS.ARBITRAGE_INFO);
            if (!info) return false;
            const hasMexc = info.textContent.includes('MEXC'); 
            return hasMexc;

        }).map(card => card.querySelector(SELECTORS.TRADE_CARD_TITLE_STRONG)?.textContent.trim() || 'Unnamed Card');

        if (mexcCardTitles.length === 0) {
            log("✅ Успіх: Не знайдено жодної картки MEXC для перезапуску.");
        } else {
            log(`➡️ Знайдено ${mexcCardTitles.length} карток MEXC для перезапуску.`);
            log(`➡️ Починаємо цикл з ПРЯМОГО порядку.`);
            for (let i = 0; i < mexcCardTitles.length; i++) {
                const title = mexcCardTitles[i];
                log(`\n♻️ Обробка картки ${i + 1}/${mexcCardTitles.length} (Оригінальний індекс: ${i})`);
                await handleRestartCard(title);
            }
            log("✅ Успіх: Всі картки MEXC оброблено.");
        }

        isRestartProcessScheduled = false;

        // Повернення кнопки у початковий стан
        if (restartBtn) {
            restartBtn.style.backgroundColor = SELECTORS.DEFAULT_BUTTON_COLOR;
            restartBtn.disabled = false;
            restartBtn.textContent = 'Restart MEXC Cards';
        }
        
        addKeyClickHappened = false; 
    }

    
    /**
     * КЛЮЧОВА ЗМІНА: Перехоплення window.alert
     */
    window.alert = function(message) {
        log("Alert з'явився:", message);
        
        // 1. Викликаємо оригінальний alert - виконання тут блокується до натискання 'ОК'
        originalAlert(message);
        
        log("Alert зник.");

        // 2. Логіка автозапуску
        const triggerMessage = message ? message.toLowerCase() : '';
        const triggerKeyword = SELECTORS.ALERT_TRIGGER_KEYWORD.toLowerCase();
        
        if (addKeyClickHappened && triggerMessage.includes(triggerKeyword)) {
             clearAddKeyTimeout(); // ЗМІНА 3: Очищуємо тайм-аут, якщо alert успішний
             log("⚡️ Автозапуск: Виявлено успішне збереження ключів. Запуск перезапуску карток...");
             findMexcCardsAndRestart(); 
        } else if (addKeyClickHappened) {
            log(`⚠️ Alert не містить ключового слова (${triggerKeyword}). Автозапуск не відбудеться.`);
            clearAddKeyTimeout(); // Очищуємо тайм-аут
            addKeyClickHappened = false; 
        }
    };


    /**
     * Налаштування кнопок
     */
    function setupRestartButton() {
        const saveApiKeysBlock = document.querySelector(SELECTORS.SAVE_API_KEYS_BLOCK);
        if (!saveApiKeysBlock) {
            log("❌ Помилка: Не знайдено блок для API ключів. Скрипт не може додати кнопку.");
            return;
        }
        
        // 1. Додавання кнопки перезапуску
        if (document.getElementById(SELECTORS.NEW_RESTART_BUTTON_ID)) {
             document.getElementById(SELECTORS.NEW_RESTART_BUTTON_ID).remove();
        }

        const restartBtn = document.createElement('button');
        restartBtn.id = SELECTORS.NEW_RESTART_BUTTON_ID;
        restartBtn.textContent = 'Restart MEXC Cards';
        
        const addKeyBtn = findElementByText(SELECTORS.SAVE_API_KEYS_BLOCK + ' button', SELECTORS.ADD_MEXC_KEY_BTN_TEXT);
        
        if (addKeyBtn) {
            restartBtn.style.cssText = addKeyBtn.style.cssText;
            restartBtn.style.marginLeft = '10px'; 
            restartBtn.style.backgroundColor = SELECTORS.DEFAULT_BUTTON_COLOR; 
        } else {
             Object.assign(restartBtn.style, {
                padding: '5px 15px',
                fontSize: '14px',
                cursor: 'pointer',
                backgroundColor: SELECTORS.DEFAULT_BUTTON_COLOR,
                color: 'white',
                border: 'none',
                borderRadius: '5px'
            });
        }
        
        saveApiKeysBlock.appendChild(restartBtn);
        
        log("✅ Кнопка 'Restart MEXC Cards' додана. Очікування кліку для запуску.");

        // Обробник кліку на кнопку перезапуску
        restartBtn.addEventListener('click', () => {
             log("➡️ Користувач натиснув 'Restart MEXC Cards'. Запуск циклу.");
             findMexcCardsAndRestart();
        });

        // 2. Перехоплення кліку на "Add MEXC Key..."
        if (addKeyBtn) {
            if (!addKeyBtn.hasAttribute('data-mexc-listener')) {
                 addKeyBtn.addEventListener('click', () => {
                     log("➡️ Користувач натиснув 'Add MEXC Key...'. Активовано очікування alert.");
                     addKeyClickHappened = true; 
                     resetAddKeyFlagAfterTimeout(); // ЗМІНА 2: Встановлюємо тайм-аут
                 });
                 addKeyBtn.setAttribute('data-mexc-listener', 'true');
            }
        } else {
            log("❌ Помилка: Не знайдено кнопку 'Add MEXC Key...' для налаштування автозапуску.");
        }
    }

    // Запуск функції налаштування
    setupRestartButton();
    
    // Додавання поліфіла для closest, якщо його немає
    if (!Element.prototype.closest) {
        Element.prototype.closest = function(s) {
            let el = this;
            do {
                if (el.matches(s)) return el;
                el = el.parentElement || el.parentNode;
            } while (el !== null && el.nodeType === 1);
            return null;
        };
    }

})();