const TIME_TRACKING_ENTITY = 'timeTracking';

class Slingr {
    constructor(app, env, token) {
        this.url = `https://${app}.slingrs.io/${env}/runtime/api`;
        this.token = token;
    }

    login = async (email, pass) => {
        let res = await fetch(`${this.url}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: email,
                password: pass,
            }),
        });
        if (! res.ok) {
            throw new Error(`[${res.status}] ${res.statusText}`);
        }
        let data = await res.json();
        this.token = data.token;
        this.user = data.user;
        return res;
    }

    getCurrentUser = async () => {
        if (! this.token) {
            throw new Error('Not logged in');
        }
        this.user = await this.get('/users/current');
        return this.user;
    }

    request = async (method, path, params = {}, payload) => {
        let query = new URLSearchParams(params);
        let url = `${this.url}${path}?${query}`;

        let opts = {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Token': this.token,
            },
        }
        if (payload) {
            opts.body = JSON.stringify(payload);
        }
        let res = await fetch(url, opts);
        if (! res.ok) {
            throw new Error(`[${res.status}] ${res.statusText}`);
        }
        return await res.json();
    }

    get = (path, params = {}) => {
        return this.request('GET', path, params);
    }

    post = (path, payload) => {
        return this.request('POST', path, {}, payload);
    }

    put = (path, payload) => {
        return this.request('PUT', path, {}, payload);
    }

    delete = (path) => {
        return this.request('DELETE', path);
    }
}

class ViewModel {
    constructor() {
        this.slingr = new Slingr('solutions', 'prod');
        this.originalTitle = document.title;

        // Login
        this.email = ko.observable(localStorage.getItem('solutions:timetracking:email') || null);
        this.pass = ko.observable(null);
        this.logginIn = ko.observable(false);
        this.logged = ko.observable(false);
        this.logged.subscribe(val => {
            if (val) {
                this.addToast('Logged in');
                this.initCalendar();
            }
        });

        let token = localStorage.getItem('solutions:timetracking:token');
        if (token) {
            console.log('Using token', token);
            this.slingr.token = token;
            this.logginIn(true);
            this.slingr.getCurrentUser()
            .then(user => {
                console.log('Logged in as', user);
                this.logged(true);
                localStorage.setItem('solutions:timetracking:token', this.slingr.token);
            })
            .catch(e => {
                console.warn('Invalid token', e);
                this.slingr.token = null;
                localStorage.removeItem('solutions:timetracking:token');
                this.logged(false);
                this.addToast('Invalid token or expired', 'error');
            })
            .finally(e => {
                this.logginIn(false);
            });
        }

        // Dashboard
        this.loading = ko.observable(true);

        // Toasts
        this.toasts = ko.observableArray([]);
        this.toasts.subscribe(changes => {
            changes.forEach(change => {
                if (change.status === 'added') {
                    const toastData = change.value;
                    // We need to wait for Knockout to render the element
                    setTimeout(() => {
                        const toastEl = document.getElementById(toastData.id);
                        if (toastEl) {
                            const toast = new bootstrap.Toast(toastEl);
                            toast.show();
                            toastEl.addEventListener('hidden.bs.toast', () => {
                                this.toasts.remove(toastData);
                            });
                        }
                    }, 50);
                }
            });
        }, null, 'arrayChange');
        // Calendar
        this.holidays = ko.observableArray([]);
        this.month = ko.observable(new Date().getMonth());
        this.year = ko.observable(new Date().getFullYear());

        // Time Tracking
        this.weeks = ko.observableArray([]);
        this.projects = ko.observableArray([]);
        this.showWeekends = ko.observable(false);

        // Filters
        this.filterMissingHours = ko.observable(false);
        this.filterHideLeaveDays = ko.observable(true);
        this.filterOnlyToday = ko.observable(false);
        this.filterOnlyCurrentWeek = ko.observable(false);

        // Keybindings
        const storedKeybindings = localStorage.getItem('solutions:timetracking:keybindingsEnabled');
        this.keybindingsEnabled = ko.observable(storedKeybindings ? JSON.parse(storedKeybindings) : false);
        this.navigationMode = ko.observable('none'); // 'none', 'day', 'entry'
        this.selectedDay = ko.observable(null);
        this.selectedEntry = ko.observable(null);

        this.visibleDays = ko.computed(() => {
            return this.weeks().map(w => w.days()).flat().filter(d => d.isVisible());
        });

        this.keybindingsEnabled.subscribe(val => {
            localStorage.setItem('solutions:timetracking:keybindingsEnabled', JSON.stringify(val));
            if (val) {
                this.activateDayNavigation();
            } else {
                this.deactivateKeybindings();
            }
        });

        this.visibleDays.subscribe(days => {
            if (this.keybindingsEnabled() && this.navigationMode() === 'day') {
                if (days.length > 0 && !days.includes(this.selectedDay())) {
                    this.selectedDay(days[0]);
                    this.scrollToDay(days[0]);
                } else if (days.length === 0) {
                    this.selectedDay(null);
                }
            }
        });

        this.monthProgress = {
            scopes: ko.observableArray([]),
            total: ko.observable('0h'),
            missing: ko.observable(0),
        };
        this.monthScopeChart = null;
        this.projectHoursChart = null;
        this.billable = ko.observable(true);
        this.notes = ko.observable('');

        this.leaveDays = ko.observableArray(JSON.parse(localStorage.getItem('solutions:timetracking:leavedays')) || []);
        this.leaveDays.subscribe(val => {
            localStorage.setItem('solutions:timetracking:leavedays', JSON.stringify(val));
        });

        this.selectedDayForNewEntry = ko.observable(null);
        this.newEntryModal = null;

        this.selectedEntryForEdit = ko.observable(null);
        this.editEntryModal = null;

        this.entryForRemoval = ko.observable(null);
        this.removeConfirmModal = null;

        this.keybindingsHelpModal = null;

        // Pomodoro
        this.pomodoroModal = null;
        this.pomodoroDurationMinutes = ko.observable(50);
        this.pomodoroRemainingTime = ko.observable(50 * 60);
        this.pomodoroTimerId = null;
        this.pomodoroIsRunning = ko.observable(false);
        this.pomodoroFinished = ko.observable(false);
        this.faviconBlinkerId = null;
        this.originalFavicon = null; // will be set later
        this.blankFavicon = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

        this.pomodoroDisplayTime = ko.computed(() => {
            const totalSeconds = this.pomodoroRemainingTime();
            const isNegative = totalSeconds < 0;
            const absSeconds = Math.abs(totalSeconds);
            const minutes = Math.floor(absSeconds / 60);
            const seconds = absSeconds % 60;
            const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            return isNegative ? `-${formattedTime}` : formattedTime;
        });

        ko.computed(() => {
            if (this.pomodoroIsRunning()) {
                const time = this.pomodoroDisplayTime();
                document.title = `${time} - ${this.originalTitle}`;
            } else {
                if (document.title !== this.originalTitle) {
                    document.title = this.originalTitle;
                }
            }
        });

        this.submitRemove = async () => {
            const entryToRemove = this.entryForRemoval();
            if (!entryToRemove) return;

            this.loading(true);
            try {
                await this.slingr.delete(`/data/${TIME_TRACKING_ENTITY}/${entryToRemove.id()}`);

                const day = entryToRemove.day;
                day.entries.remove(entryToRemove);

                // Update day totals
                day.durationMs -= entryToRemove.raw.timeSpent;
                day.duration(formatMsToDuration(day.durationMs));
                day.durationBillableMs -= entryToRemove.raw.timeSpent;
                day.durationBillable(formatMsToDuration(day.durationBillableMs));

                // Update selection for keybindings
                if (this.keybindingsEnabled() && this.navigationMode() === 'entry') {
                    const removedIndex = day.entries.indexOf(entryToRemove);
                    if (day.entries().length > 0) {
                        const newIndex = Math.min(removedIndex, day.entries().length - 1);
                        this.selectedEntry(day.entries()[newIndex]);
                    } else {
                        this.selectedEntry(null);
                    }
                }

                await this.updateStats();

                this.addToast('Entry removed successfully.', 'success');
                this.removeConfirmModal.hide();
                this.entryForRemoval(null);
            } catch (e) {
                console.error(e);
                this.addToast('Error removing entry.', 'error');
            } finally {
                this.loading(false);
            }
        }

        // Theme
        const storedTheme = localStorage.getItem('solutions:timetracking:theme') || 'dark';
        this.theme = ko.observable(storedTheme);
        this.isDarkMode = ko.computed({
            read: () => this.theme() === 'dark',
            write: (value) => this.theme(value ? 'dark' : 'light')
        });

        this.theme.subscribe(newTheme => {
            localStorage.setItem('solutions:timetracking:theme', newTheme);
            document.documentElement.setAttribute('data-bs-theme', newTheme);
            if (this.calendar) {
                this.calendar.set({ selectedTheme: newTheme });
            }
        });
    }

    showKeybindingsHelp = () => {
        if (!this.keybindingsHelpModal) {
            this.keybindingsHelpModal = new bootstrap.Modal(document.getElementById('keybindingsHelpModal'));
        }
        this.keybindingsHelpModal.show();
    }

    showPomodoroModal = () => {
        if (!this.originalFavicon) {
            const faviconEl = document.getElementById('runtimeAppFavicon');
            if (faviconEl) {
                this.originalFavicon = faviconEl.href;
            }
        }
        if (!this.pomodoroModal) {
            this.pomodoroModal = new bootstrap.Modal(document.getElementById('pomodoroModal'));
        }
        // Reset timer if not running
        if (!this.pomodoroIsRunning()) {
            this.pomodoroRemainingTime(this.pomodoroDurationMinutes() * 60);
            this.pomodoroFinished(false);
        }
        this.pomodoroModal.show();
    }

    startPomodoro = () => {
        if (this.pomodoroIsRunning()) return;

        this.pomodoroRemainingTime(this.pomodoroDurationMinutes() * 60);
        this.pomodoroIsRunning(true);
        this.pomodoroFinished(false);
        this.stopFaviconBlinking();

        this.pomodoroTimerId = setInterval(() => {
            const remaining = this.pomodoroRemainingTime() - 1;
            this.pomodoroRemainingTime(remaining);
            if (remaining === 0) {
                this.pomodoroFinished(true);
                this.startFaviconBlinking();
            }
        }, 1000);
    }

    stopPomodoro = () => {
        if (!this.pomodoroIsRunning()) return;

        clearInterval(this.pomodoroTimerId);
        this.pomodoroTimerId = null;
        this.pomodoroIsRunning(false);
        this.pomodoroFinished(false);
        this.stopFaviconBlinking();
        if (this.pomodoroModal) {
            this.pomodoroModal.hide();
        }
    }

    restartPomodoro = () => {
        if (!this.pomodoroIsRunning()) return;

        this.pomodoroRemainingTime(this.pomodoroDurationMinutes() * 60);
        this.pomodoroFinished(false);
        this.stopFaviconBlinking();
    }

    activateDayNavigation = () => {
        this.navigationMode('day');
        // Wait for visibleDays to update
        setTimeout(() => {
            if (!this.selectedDay() && this.visibleDays().length > 0) {
                this.selectedDay(this.visibleDays()[0]);
            }
            if (this.selectedDay()) {
                this.scrollToDay(this.selectedDay());
            }
        }, 100);
    }

    deactivateKeybindings = () => {
        this.navigationMode('none');
        this.selectedDay(null);
        this.selectedEntry(null);
    }

    startFaviconBlinking = () => {
        if (this.faviconBlinkerId) return;
        let state = false;
        this.faviconBlinkerId = setInterval(() => {
            const favicon = document.getElementById('runtimeAppFavicon');
            if (favicon) {
                favicon.href = state ? this.originalFavicon : this.blankFavicon;
                state = !state;
            }
        }, 500);
    }

    stopFaviconBlinking = () => {
        if (this.faviconBlinkerId) {
            clearInterval(this.faviconBlinkerId);
            this.faviconBlinkerId = null;
        }
        const favicon = document.getElementById('runtimeAppFavicon');
        if (favicon && this.originalFavicon) {
            favicon.href = this.originalFavicon;
        }
    }

    login = async () => {
        this.logginIn(true);
        this.slingr.token = null;
        try {
            await this.slingr.login(this.email(), this.pass());
        } catch (e) {
            this.addToast('Invalid email or password', 'error');
        }
        if (this.slingr.token) {
            localStorage.setItem('solutions:timetracking:email', this.email());
            let user = await this.slingr.getCurrentUser();
            localStorage.setItem('solutions:timetracking:token', this.slingr.token);
            console.log('Logged', user);
            this.logged(true);
        }
        this.pass(null);
        this.logginIn(false);
    }

    logout = () => {
        this.slingr.post('/auth/logout');
        this.slingr.token = null;
        this.slingr.user = null;
        localStorage.removeItem('solutions:timetracking:token');
        this.logged(false);
        this.addToast('Logged out successfully.', 'success');
    }

    scrollToDay = (day, block = 'center') => {
        if (!day) return;
        const dayElement = document.getElementById(day.dateStr());
        if (dayElement) {
            dayElement.scrollIntoView({ behavior: 'smooth', block: block });
            dayElement.focus({ preventScroll: true });
        }
    }

    scrollToEntry = (entry) => {
        if (!entry) return;
        const entryElement = document.getElementById('entry-' + entry.id());
        if (entryElement) {
            entryElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    expandWeekAndScroll = (day) => {
        if (!day) return;
        const week = day.week;
        if (week && week.isCollapsed()) {
            week.isCollapsed(false);
            const weekElement = document.getElementById(week.id);
            if (weekElement) {
                const bsCollapse = bootstrap.Collapse.getOrCreateInstance(weekElement);
                bsCollapse.show();
            }
        }
        this.scrollToDay(day);
    }

    handleKeyPress = (e) => {
        const activeModalElement = document.querySelector('.modal.show');
        const isModalOpen = !!activeModalElement;
 
        if (isModalOpen) {
            this.handleModalKeys(e, activeModalElement);
            return;
        }
 
        if (!this.keybindingsEnabled()) return;

        const isInputFocused = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
 
        if (isInputFocused) {
            if (e.key === 'Escape') {
                document.activeElement.blur();
                e.preventDefault();
            }
            return;
        }
 
        if (e.key === 'h') {
            e.preventDefault();
            this.showKeybindingsHelp();
            return;
        }

        if (e.key === 'g') {
            e.preventDefault();
            if (this.visibleDays().length > 0) {
                this.selectedDay(this.visibleDays()[0]);
                this.expandWeekAndScroll(this.selectedDay());
            }
            return;
        }

        if (e.key === 'G') {
            e.preventDefault();
            // Navigate and select the last day of the list
            if (this.visibleDays().length > 0) {
                this.selectedDay(this.visibleDays()[this.visibleDays().length - 1]);
                this.expandWeekAndScroll(this.selectedDay());
            }
            return;
        }

        const mode = this.navigationMode();
        if (mode === 'day') {
            this.handleDayNavigation(e);
        } else if (mode === 'entry') {
            this.handleEntryNavigation(e);
        }
    }
 
    handleModalKeys = (e, modalElement) => {
        switch (e.key) {
            case 'Escape':
                e.preventDefault();
                const modal = bootstrap.Modal.getInstance(modalElement);
                if (modal) {
                    modal.hide();
                }
                break;
            case 'Enter':
                // Allow default behavior for Enter in textareas (new line), unless Ctrl/Meta is pressed.
                if (document.activeElement.tagName === 'TEXTAREA' && !e.ctrlKey && !e.metaKey) {
                    return;
                }
                e.preventDefault();
                const confirmButton = modalElement.querySelector('.modal-footer .btn-primary, .modal-footer .btn-danger');
                if (confirmButton && !confirmButton.disabled) {
                    confirmButton.click();
                }
                break;
        }
    }

    handleDayNavigation = (e) => {
        const visibleDays = this.visibleDays();
        if (visibleDays.length === 0) return;

        let currentIndex = visibleDays.indexOf(this.selectedDay());
        if (currentIndex === -1 && visibleDays.length > 0) {
            currentIndex = 0;
            this.selectedDay(visibleDays[0]);
        }

        switch (e.key) {
            case 'j':
                e.preventDefault();
                if (currentIndex < visibleDays.length - 1) {
                    const newDay = visibleDays[currentIndex + 1];
                    this.selectedDay(newDay);
                    this.expandWeekAndScroll(newDay);
                }
                break;
            case 'k':
                e.preventDefault();
                if (currentIndex > 0) {
                    const newDay = visibleDays[currentIndex - 1];
                    this.selectedDay(newDay);
                    this.expandWeekAndScroll(newDay);
                }
                break;
            case 'a':
                e.preventDefault();
                this.openNewEntryModal(this.selectedDay());
                break;
            case 'Enter':
                e.preventDefault();
                if (this.selectedDay()) {
                    this.navigationMode('entry');
                    if (this.selectedDay().entries().length > 0) {
                        const firstEntry = this.selectedDay().entries()[0];
                        this.selectedEntry(firstEntry);
                        setTimeout(() => this.scrollToEntry(firstEntry), 50);
                    } else {
                        this.selectedEntry(null);
                    }
                }
                break;
            case 't':
                e.preventDefault();
                this.goToToday();
                break;
        }
    }

    handleEntryNavigation = (e) => {
        const currentDay = this.selectedDay();
        if (!currentDay) return;

        const entries = currentDay.entries();
        let currentIndex = entries.indexOf(this.selectedEntry());

        if (entries.length === 0 && ['j', 'k', 'e', 'r', '+', '-'].includes(e.key)) {
            e.preventDefault();
            return; // No entries to navigate/act on
        }

        switch (e.key) {
            case 'j':
                e.preventDefault();
                if (entries.length > 0) {
                    if (currentIndex === -1) {
                        this.selectedEntry(entries[0]);
                    } else if (currentIndex < entries.length - 1) {
                        this.selectedEntry(entries[currentIndex + 1]);
                    }
                    this.scrollToEntry(this.selectedEntry());
                }
                break;
            case 'k':
                e.preventDefault();
                if (currentIndex > 0) {
                    this.selectedEntry(entries[currentIndex - 1]);
                    this.scrollToEntry(this.selectedEntry());
                }
                break;
            case 'Escape':
                e.preventDefault();
                this.navigationMode('day');
                this.selectedEntry(null);
                this.scrollToDay(this.selectedDay());
                break;
            case 'a':
                e.preventDefault();
                this.openNewEntryModal(currentDay);
                break;
            case 'e':
                e.preventDefault();
                if (this.selectedEntry()) {
                    this.selectedEntry().edit(this.selectedEntry());
                }
                break;
            case 'r':
                e.preventDefault();
                if (this.selectedEntry()) {
                    this.openRemoveConfirmModal(this.selectedEntry());
                }
                break;
            case '+':
                e.preventDefault();
                if (this.selectedEntry() && !this.selectedEntry().readOnly()) {
                    this.selectedEntry().updateTime(1800000); // 30 minutes
                }
                break;
            case '-':
                e.preventDefault();
                if (this.selectedEntry() && !this.selectedEntry().readOnly()) {
                    this.selectedEntry().updateTime(-1800000); // -30 minutes
                }
                break;
        }
    }

    openNewEntryModal = (day) => {
        this.selectedDayForNewEntry(day);
        if (!this.newEntryModal) {
            this.newEntryModal = new bootstrap.Modal(document.getElementById('newEntryModal'));
        }
        this.newEntryModal.show();
    }

    openEditEntryModal = (entry) => {
        this.selectedEntryForEdit(entry);
        if (!this.editEntryModal) {
            this.editEntryModal = new bootstrap.Modal(document.getElementById('editEntryModal'));
        }
        this.editEntryModal.show();
    }

    openRemoveConfirmModal = (entry) => {
        this.entryForRemoval(entry);
        if (!this.removeConfirmModal) {
            this.removeConfirmModal = new bootstrap.Modal(document.getElementById('removeConfirmModal'));
        }
        this.removeConfirmModal.show();
    }

    addToast = (msg, type = 'info', title = null) => {
        let id = 'toast-' + new Date().getTime();
        if (title === null) {
            switch (type) {
                case 'error':
                    title = 'Error';
                    break;
                case 'warning':
                    title = 'Warning';
                    break;
                case 'success':
                    title = 'Success';
                    break;
                default: // 'info'
                    title = 'Info';
            }
        }
        this.toasts.push({
            id: id,
            title: title,
            msg: msg,
            error: type === 'error',
            warning: type === 'warning',
            info: type === 'info',
            success: type === 'success',
        });
    }

    // Calendar
    initCalendar = async () => {
        let settings = {
            type: 'month',
            selectedMonth: this.month(),
            selectedYear: this.year(),
            selectedTheme: this.theme(),
            onClickMonth: async (calendar, event) => {
                this.month(calendar.context.selectedMonth);
                await this.updateDashboard();
                if (this.keybindingsEnabled()) {
                    this.activateDayNavigation();
                }
                this.calendar.selectedMonth = calendar.context.selectedMonth;
                this.calendar.update();
            },
            onClickYear: async (calendar, event) => {
                this.year(calendar.context.selectedYear);
                await this.updateDashboard();
                if (this.keybindingsEnabled()) {
                    this.activateDayNavigation();
                }
                this.calendar.selectedMonth = calendar.context.selectedMonth;
                this.calendar.selectedYear = calendar.context.selectedYear;
                this.calendar.update();
            },
            onClickArrow: async (calendar, event) => {
                this.month(calendar.context.selectedMonth);
                this.year(calendar.context.selectedYear);
                await this.updateDashboard();
                if (this.keybindingsEnabled()) {
                    this.activateDayNavigation();
                }
            }
        }
        this.calendar = new VanillaCalendarPro.Calendar('#calendar', settings);
        this.calendar.init();
        await this.updateDashboard();
        if (this.keybindingsEnabled()) {
            this.activateDayNavigation();
        }
    }

    updateDashboard = async () => {
        this.loading(true);
        await this.updateHolidays();
        await this.updateTimeTracking();
        this.loading(false);
    }

    goToToday = async () => {
        let today = new Date();
        const todayDateStr = getDateString(today);

        if (this.month() !== today.getMonth() || this.year() !== today.getFullYear()) {
            this.month(today.getMonth());
            this.year(today.getFullYear());
            this.calendar.set({ selectedMonth: this.month(), selectedYear: this.year() });
            await this.updateDashboard();
        }

        // After updateDashboard, data is fresh.
        const allDays = this.weeks().map(w => w.days()).flat();
        const todayDayObject = allDays.find(d => d.dateStr() === todayDateStr);

        if (todayDayObject) {
            // If keybindings are on and today is visible, select it.
            if (this.keybindingsEnabled() && todayDayObject.isVisible()) {
                this.selectedDay(todayDayObject);
                this.expandWeekAndScroll(todayDayObject);
            } else {
                // Otherwise, just scroll to it.
                this.scrollToDay(todayDayObject);
            }
        }
    }

    // Get holidays of the month
    updateHolidays = async () => {
        let query = {
            // todo -> filter by country
            day: `between(${this.getStartMonth().getTime()},${this.getEndMonth().getTime()})`,
            _size: 1000,
            _sortField: 'day',
            _sortType: 'asc',
        }
        //let { items: holidays } = await this.slingr.get('/data/management.holidays', query);
        let { items: holidays } = JSON.parse(`{"total":2,"offset":"6716b9119ecada7d9349a037","items":[{"id":"68482c459450ec084b4e4f39","version":0,"label":"June , 16 - Passing to Immortality of General Martín Güemes","entity":{"id":"5e84a6cb07081b50bd6c1bc6","name":"management.holidays"},"country":{"id":"5c617a71bbaa2e000c9a4740","label":"Argentina"},"day":"2025-06-16","title":"Passing to Immortality of General Martín Güemes","ignore":false},{"id":"6716b9119ecada7d9349a037","version":0,"label":"June , 20 - Anniversary of the Death of General Manuel Belgrano","entity":{"id":"5e84a6cb07081b50bd6c1bc6","name":"management.holidays"},"country":{"id":"5c617a71bbaa2e000c9a4740","label":"Argentina"},"day":"2025-06-20","title":"Anniversary of the Death of General Manuel Belgrano","ignore":false}]}`)
        holidays.push({ day: '2025-06-02', label: 'Leave' });
        this.calendar.set({ selectedHolidays: holidays.map(h => h.day) });
        this.holidays(holidays)
    }

    updateTimeTracking = async () => {
        let [start, end] = [this.getStartMonth(), this.getEndMonth()];
        let query = {
            _size: 1000,
            _sortField: 'date',
            _sortType: 'asc',
            date: `between(${start.getTime()},${end.getTime()})`,
            person: this.slingr.user.id,
        }
        let { items: entries } = await this.slingr.get(`/data/${TIME_TRACKING_ENTITY}`, query);

        let weeks = this.listWeeksBetweenMonth()
            .map(week => new Week(week, entries));
        this.weeks(weeks);

        await this.updateStats();
    }

    updateStats = async () => {
        let totalMonthMs = this.weeks().map(w => w.days()).flat().filter(d => d.isBussinessDay()).length * 8 * 60 * 60 * 1000;
        if (totalMonthMs === 0) totalMonthMs = 1; // Avoid division by zero
        let entries = this.weeks().map(w => w.days()).flat().map(d => d.entries()).flat();
 
        const scopeStats = {
            global: { timeSpent: 0, color: 'rgb(13, 110, 253)', name: 'Global' },
            task: { timeSpent: 0, color: 'rgb(25, 135, 84)', name: 'Task' },
            supportTicket: { timeSpent: 0, color: 'rgb(220, 53, 69)', name: 'Ticket' },
        };
 
        let totalTimeSpent = 0;
        for (const entry of entries) {
            const scope = entry.scope();
            if (scopeStats[scope]) {
                scopeStats[scope].timeSpent += entry.raw.timeSpent;
            }
            totalTimeSpent += entry.raw.timeSpent;
        }
 
        const scopeProgress = [];
        const chartData = {
            labels: [],
            datasets: [{
                data: [],
                backgroundColor: [],
            }]
        };
 
        const scopeClassMap = {
            global: { colorClass: 'bg-primary', textColor: 'text-primary' },
            task: { colorClass: 'bg-success', textColor: 'text-success' },
            supportTicket: { colorClass: 'bg-danger', textColor: 'text-danger' },
        };
 
        for (const scope in scopeStats) {
            const stat = scopeStats[scope];
            if (stat.timeSpent > 0) {
                scopeProgress.push({
                    scope: scope,
                    name: stat.name,
                    colorClass: scopeClassMap[scope].colorClass,
                    textColor: scopeClassMap[scope].textColor,
                    duration: formatMsToDuration(stat.timeSpent),
                    percentage: ((stat.timeSpent / totalMonthMs) * 100).toFixed(2) + '%',
                });
                chartData.labels.push(stat.name);
                chartData.datasets[0].data.push(stat.timeSpent);
                chartData.datasets[0].backgroundColor.push(stat.color);
            }
        }
 
        this.monthProgress.scopes(scopeProgress);
        this.monthProgress.total(formatMsToDuration(totalTimeSpent));

        const missingMs = totalMonthMs - totalTimeSpent;
        this.monthProgress.missing(missingMs > 0 ? missingMs : 0);
 
        this.updateMonthScopeChart(chartData);
 
        await this.updateProjectStats(totalMonthMs);
    }
 
    updateMonthScopeChart = (chartData) => {
        const ctx = document.getElementById('monthScopeChart');
        if (!ctx) return;
 
        if (this.monthScopeChart) {
            this.monthScopeChart.data.labels = chartData.labels;
            this.monthScopeChart.data.datasets = chartData.datasets;
            this.monthScopeChart.update();
        } else {
            this.monthScopeChart = new Chart(ctx, {
                type: 'doughnut',
                data: chartData,
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: false
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    let label = context.label || '';
                                    if (label) {
                                        label += ': ';
                                    }
                                    if (context.parsed !== null) {
                                        label += formatMsToDuration(context.parsed);
                                    }
                                    return label;
                                }
                            }
                        }
                    }
                }
            });
        }
    }
 
    updateProjectStats = async (totalMonthMs) => {
        let { items: projects } = await model.slingr.get('/data/projects', {
            'members.user': model.slingr.user.id,
            _sortField: 'name',
            _sortType: 'asc',
            _size: 1000,
        });
        this.projects(projects.map(p => ({ id: p.id, name: p.label })));
 
        const projectChartData = {
            labels: [],
            datasets: [
                {
                    label: 'Global',
                    data: [],
                    backgroundColor: 'rgb(13, 110, 253)',
                },
                {
                    label: 'Task',
                    data: [],
                    backgroundColor: 'rgb(25, 135, 84)',
                },
                {
                    label: 'Ticket',
                    data: [],
                    backgroundColor: 'rgb(220, 53, 69)',
                }
            ]
        };
 
        const projectsWithTime = [];
 
        for (let project of projects) {
            let projectEntries = this.weeks()
                .map(w => w.days()).flat()
                .map(d => d.entries()).flat()
                .filter(e => e.raw.project.id === project.id);
 
            const projectScopeStats = {
                global: 0,
                task: 0,
                supportTicket: 0,
            };
 
            for (const entry of projectEntries) {
                const scope = entry.scope();
                if (projectScopeStats.hasOwnProperty(scope)) {
                    projectScopeStats[scope] += entry.raw.timeSpent;
                }
            }
            
            projectsWithTime.push({
                name: project.label,
                stats: projectScopeStats,
                total: projectScopeStats.global + projectScopeStats.task + projectScopeStats.supportTicket
            });
        }
 
        // Sort projects by total time descending
        projectsWithTime.sort((a, b) => b.total - a.total);
 
        for (const project of projectsWithTime) {
            projectChartData.labels.push(project.name);
            projectChartData.datasets[0].data.push(project.stats.global / (1000 * 60 * 60));
            projectChartData.datasets[1].data.push(project.stats.task / (1000 * 60 * 60));
            projectChartData.datasets[2].data.push(project.stats.supportTicket / (1000 * 60 * 60));
        }
 
        this.updateProjectHoursChart(projectChartData);
    }
 
    updateProjectHoursChart = (chartData) => {
        const ctx = document.getElementById('projectHoursChart');
        if (!ctx) return;
 
        if (this.projectHoursChart) {
            this.projectHoursChart.data = chartData;
            this.projectHoursChart.update();
        } else {
            this.projectHoursChart = new Chart(ctx, {
                type: 'bar',
                data: chartData,
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: false,
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    let label = context.dataset.label || '';
                                    if (label) {
                                        label += ': ';
                                    }
                                    if (context.parsed.x !== null) {
                                        label += context.parsed.x.toFixed(1) + 'h';
                                    }
                                    return label;
                                },
                                footer: function(tooltipItems) {
                                    const dataIndex = tooltipItems[0].dataIndex;
                                    const datasets = tooltipItems[0].chart.data.datasets;
                                    let total = 0;
                                    datasets.forEach(dataset => {
                                        total += dataset.data[dataIndex] || 0;
                                    });
                                    return 'Total: ' + total.toFixed(1) + 'h';
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            stacked: true,
                            title: {
                                display: true,
                                text: 'Hours'
                            }
                        },
                        y: {
                            stacked: true,
                            ticks: {
                                autoSkip: false,
                                callback: function(value, index, values) {
                                    const label = this.getLabelForValue(value);
                                    return label.length > 20 ? label.substring(0, 20) + '...' : label;
                                }
                            }
                        }
                    }
                }
            });
        }
    }

    exportToCsv = () => {
        try {
            const headers = ["Date", "Project", "Scope", "Task/Ticket", "Duration", "Notes"];
            const rows = [];

            this.weeks().forEach(week => {
                if (!week.isVisible()) return;
                week.days().forEach(day => {
                    if (!day.isVisible()) return;
                    day.entries().forEach(entry => {
                        const sanitize = (str) => str.replace(/"/g, '""').replace(/\r?\n/g, ' ');
                        const notes = sanitize(entry.notes() || '');
                        const task = sanitize(entry.task() || '');
                        const scopes = { task: 'Task', supportTicket: 'Ticket', global: 'Global' };
                        const scope = scopes[entry.scope()];

                        const rowData = [
                            day.dateStr(),
                            `"${entry.project()}"`,
                            `"${scope}"`,
                            `"${task}"`,
                            `"${entry.duration()}"`,
                            `"${notes}"`
                        ];
                        rows.push(rowData.join(","));
                    });
                });
            });

            if (rows.length === 0) {
                this.addToast('No visible entries to export.', 'info', 'Export');
                return;
            }

            let csvContent = headers.join(",") + "\r\n" + rows.join("\r\n");

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement("a");
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);

            const monthDate = new Date(this.year(), this.month(), 1);
            const monthName = monthDate.toLocaleString('default', { month: 'long' });
            const year = this.year();
            link.setAttribute("download", `time-entries-${monthName}-${year}.csv`);
            
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            this.addToast('Your time entries have been exported.', 'success', 'Export Successful');
        } catch (e) {
            console.error('Error exporting to CSV', e);
            this.addToast('An unexpected error occurred during export.', 'error', 'Export Failed');
        }
    };

    // Calendar utils
    listDaysBetweenMonth = () => {
        let days = [];
        for (let d = this.getStartMonth(); d <= this.getEndMonth(); d.setDate(d.getDate() + 1)) {
            days.push(new Date(d));
        }
        return days;
    }
    listWeeksBetweenMonth = () => {
        let days = this.listDaysBetweenMonth();
        if (days.length === 0) {
            return [];
        }

        let weeks = [];
        let currentWeek = { week: 0, days: [] };
        weeks.push(currentWeek);

        for (let day of days) {
            // if it is Monday and not the first day of the month
            if (day.getDay() === 1 && currentWeek.days.length > 0) {
                currentWeek = { week: weeks.length, days: [] };
                weeks.push(currentWeek);
            }
            currentWeek.days.push(day);
        }
        return weeks;
    }
    getStartMonth = () => {
        return new Date(this.year(), this.month(), 1);
    }
    getEndMonth = () => {
        return new Date(this.year(), this.month() + 1, 0);
    }

}

/* Classes */

function Week(week, entries) {
    const formatDate = (date) => {
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    };
    const startDate = week.days[0];
    const endDate = week.days[week.days.length - 1];

    const self = {
        title: `Week ${week.week + 1}`,
        dateRange: `${formatDate(startDate)} - ${formatDate(endDate)}`,
        isCollapsed: ko.observable(false),
        id: `week-collapse-${week.week}`,
    };

    let days = week.days.map(d => new Day(d, entries, self));
    self.days = ko.observableArray(days);

    self.toggleCollapse = function() {
        self.isCollapsed(!self.isCollapsed());
    };

    self.isVisible = ko.computed(function() {
        return self.days().some(d => d.isVisible());
    });

    return self;
}

function Day (date, entries, week) {
    const MAX_TIME_SPENT = 8 * 60 * 60 * 1000;
    let dateStr = getDateString(date);
    let holiday = model.holidays().find(h => h.day === dateStr);
    let isLeave = model.leaveDays().includes(dateStr);
    let isHoliday = Boolean(holiday);
    let isToday = date.toDateString() === new Date().toDateString();
    let isWeekend = [0, 6].includes(date.getDay());
    let isBussinessDay = ! isWeekend && ! holiday && !isLeave;

    let day = {
        title: date.toLocaleDateString(undefined, {
            weekday: 'short',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
        }),
        date: date,
        dateStr: ko.observable(dateStr),
        week: week,
        holidayDetail: ko.observable(holiday?.title),
        entries: ko.observableArray([]),
        durationMs: 0,
        durationBillableMs: 0,
        durationNonBillable: 0,
        visibleNotes: ko.observable(true),
        // Form
        scope: ko.observable('global'),
        notes: ko.observable(''),
        timeSpent: ko.observable(1 * 60 * 60 * 1000),
        time: ko.observable('1h'),
        project: ko.observable(null),
        updateDay: async function() {
            let query = {
                _size: 1000,
                _sortField: 'createdAt',
                _sortType: 'asc',
                date: this.dateStr(),
                person: model.slingr.user.id,
            }
            let { items: entries } = await model.slingr.get(`/data/${TIME_TRACKING_ENTITY}`, query);

            this.entries.removeAll();
            this.durationMs = 0;
            this.durationBillableMs = 0;

            for (let entry of entries) {
                let entryDate = new Entry(entry, this);
                this.durationMs += entryDate.raw.timeSpent;
                this.durationBillableMs += entry.timeSpent;
                this.entries.push(entryDate);
            }
            this.duration(formatMsToDuration(this.durationMs));
            this.durationBillable(formatMsToDuration(this.durationBillableMs));
        },
        updateTimeSpentInModal: function(amount) {
            let current = this.timeSpent();
            let newValue = current + amount;
            if (newValue >= 1800000 && newValue <= 28800000) { // 30m to 8h
                this.timeSpent(newValue);
            }
        },
        updateTimeFromInput: function() {
            const ms = parseDurationToMs(this.time());
            if (ms > 0) {
                const roundedMs = Math.round(ms / 1800000) * 1800000;
                const clampedMs = Math.max(1800000, Math.min(roundedMs, 28800000));
                if (this.timeSpent() !== clampedMs) {
                    this.timeSpent(clampedMs);
                } else {
                    this.time(formatMsToDuration(this.timeSpent()));
                }
            } else {
                this.time(formatMsToDuration(this.timeSpent()));
            }
        },
        taskId: ko.observable(null),
        ticketId: ko.observable(null),
        tasks: ko.observableArray([]),
        tickets: ko.observableArray([]),
        toggleLeave: async (day) => {
            const dateStr = day.dateStr();
            if (model.leaveDays.indexOf(dateStr) > -1) {
                model.leaveDays.remove(dateStr);
            } else {
                model.leaveDays.push(dateStr);
            }
            await model.updateStats();
        },
        logEntry: async (day) => {
            model.loading(true);
            try {
                // Ensure project is selected before logging
                if (!day.project()) {
                    model.addToast('Please select a project.', 'error');
                    model.loading(false);
                    return;
                }
                // Ensure task/ticket is selected if scope is task/ticket
                if (day.scope() === 'task' && !day.taskId()) {
                    model.addToast('Please select a task.', 'error');
                    model.loading(false);
                    return;
                }
                if (day.scope() === 'supportTicket' && !day.ticketId()) {
                    model.addToast('Please select a ticket.', 'error');
                    model.loading(false);
                    return;
                }

                await model.slingr.put(`/data/${TIME_TRACKING_ENTITY}/logTime`, {
                    project: day.project().id,
                    scope: day.scope(),
                    task: day.scope() === 'task' ? day.taskId() : null,
                    ticket: day.scope() === 'supportTicket' ? day.ticketId() : null,
                    forMe: true,
                    date: day.dateStr(),
                    timeSpent: parseInt(day.timeSpent()),
                    notes: day.notes(),
                });

                await day.updateDay();

                // Update selection for keybindings
                if (model.keybindingsEnabled() && model.navigationMode() === 'entry') {
                    const newEntry = day.entries()[day.entries().length - 1];
                    if (newEntry) {
                        model.selectedEntry(newEntry);
                        setTimeout(() => model.scrollToEntry(newEntry), 50);
                    }
                }

                // Reset form fields after successful log
                day.notes('');
                day.timeSpent(1 * 60 * 60 * 1000); // Reset to 1 hour
                day.scope('global'); // Reset scope to global
                day.taskId(null); // Clear task selection
                day.ticketId(null); // Clear ticket selection

                model.newEntryModal.hide();
                await model.updateStats();
            } catch(e) {
                console.error(e);
                model.addToast('Error logging entry.', 'error');
            }
            model.loading(false);
        },
        showNotes: (day, a) => {
            day.visibleNotes(! day.visibleNotes());
        }
    }

    day.isToday = ko.observable(isToday);
    day.isHoliday = ko.observable(isHoliday);
    day.isWeekend = ko.observable(isWeekend);
    day.isLeave = ko.computed(function() {
        return model.leaveDays().includes(dateStr);
    });
    day.isBussinessDay = ko.computed(function() {
        return !day.isWeekend() && !day.isHoliday() && !day.isLeave();
    });


    day.isLoggable = ko.computed(function() {
        if (!day.project()) {
            return false;
        }
        if (day.scope() === 'task' && !day.taskId()) {
            return false;
        }
        if (day.scope() === 'supportTicket' && !day.ticketId()) {
            return false;
        }
        if (day.notes().trim() === '') {
            return false;
        }
        return true;
    });

    // Set default project if available
    ko.computed(() => {
        if (day.project() === null && model.projects().length > 0) {
            const defaultProject = model.projects().find(p => p.name === 'Collaborative Work Solutions');
            if (defaultProject) {
                day.project(defaultProject);
            }
        }
    });

    day.timeSpent.subscribe(val => {
        day.time(formatMsToDuration(val));
    });

    const loadScopeOptions = async () => {
        const project = day.project();
        const scope = day.scope();

        day.tasks([]);
        day.tickets([]);

        if (!project || !scope || scope === 'global') {
            return;
        }

        model.loading(true);
        try {
            if (scope === 'global') return;

            let entity = '';
            let sort = {};
            let obs = null;
            if (scope === 'task') {
                obs = day.tasks;
                entity = 'dev.tasks';
                sort = { _sortField: 'createdAt', _sortType: 'desc' }
            }
            if (scope === 'supportTicket') {
                obs = day.tickets;
                entity = 'support.tickets';
                sort = { _sortField: 'draftTimestamp', _sortType: 'desc' }
            }
            const { items } = await model.slingr.get(`/data/${entity}`, {
                project: project.id,
                _size: 1000,
                ...sort,
                _fields: 'id,label,number',
            });
            obs(items.map(t => ({ id: t.id, name: t.label })));
        } catch (e) {
            console.error('Error loading scope options', e);
            model.addToast('Error loading tasks/tickets', 'error');
        } finally {
            model.loading(false);
        }
    };

    day.project.subscribe(async () => await loadScopeOptions());
    day.scope.subscribe(async () => {
        day.taskId(null);
        day.ticketId(null);
        await loadScopeOptions();
    });

    for (let entry of entries) {
        if (entry.date !== dateStr) continue;
        let entryDate = new Entry(entry, day);

        day.durationMs += entryDate.raw.timeSpent;
        day.durationBillableMs += entry.timeSpent;
        day.entries.push(entryDate);
    }
    day.duration = ko.observable(formatMsToDuration(day.durationMs));
    day.durationBillable = ko.observable(formatMsToDuration(day.durationBillableMs));
    day.durationNonBillable = ko.observable(formatMsToDuration(day.durationNonBillable));

    day.isMissingTime = ko.computed(function() {
        return day.isBussinessDay() && day.durationMs < MAX_TIME_SPENT;
    });
    day.missingDuration = ko.computed(function() {
        return day.isMissingTime() ? formatMsToDuration(MAX_TIME_SPENT - day.durationMs) : null;
    });

    day.isVisible = ko.computed(function() {
        if (model.filterOnlyToday() && !day.isToday()) {
            return false;
        }
        if (model.filterOnlyCurrentWeek()) {
            const today = new Date();
            const currentDayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
            const firstDayOfWeek = new Date(today);
            // Adjust to Monday
            firstDayOfWeek.setDate(today.getDate() - currentDayOfWeek + (currentDayOfWeek === 0 ? -6 : 1));
            firstDayOfWeek.setHours(0, 0, 0, 0);

            const lastDayOfWeek = new Date(firstDayOfWeek);
            lastDayOfWeek.setDate(firstDayOfWeek.getDate() + 6);
            lastDayOfWeek.setHours(23, 59, 59, 999);

            if (day.date < firstDayOfWeek || day.date > lastDayOfWeek) {
                return false;
            }
        }
        if (model.filterHideLeaveDays() && day.isLeave()) {
            return false;
        }
        if (model.filterMissingHours() && !day.isMissingTime()) {
            return false;
        }
        if (!model.showWeekends() && day.isWeekend() && !day.isLeave()) {
            return false;
        }
        return true;
    });

    day.canToggleLeave = ko.computed(function() {
        if (day.isWeekend() || day.isHoliday()) {
            return false;
        }
        if (day.isLeave()) {
            return true;
        }
        return day.entries().length === 0;
    });

    day.durationPercentage = ko.computed(function() {
        if (!day.isBussinessDay() || day.durationMs <= 0) {
            return 0;
        }
        const percentage = (day.durationMs / MAX_TIME_SPENT) * 100;
        return Math.min(percentage, 100);
    });

    day.durationClass = ko.computed(function() {
        const percentage = (day.durationMs / MAX_TIME_SPENT) * 100;
        if (percentage < 100) return 'bg-warning';
        if (percentage >= 100 && percentage < 110) return 'bg-success';
        return 'bg-danger'; // over 110%
    });

    return day;
}

function Entry (entry, day) {
    let readOnly = false; // entry.createDay !== getDateString(new Date());
    let duration = formatMsToDuration(entry.timeSpent);
    let shortName = entry.project.label.substring(0, 11);
    if (entry.project.label.length > 11) {
        shortName += '...';
    }
    let isInitializing = false;

    const self = {
        id: ko.observable(entry.id),
        readOnly: ko.observable(readOnly),
        project: ko.observable(entry.project.label),
        scope: ko.observable(entry.task ? 'task' : entry.ticket ? 'supportTicket' : 'global'),
        task: ko.observable(entry.task?.label ?? entry.ticket?.label ?? 'Global to the project'),
        timeSpent: ko.observable(entry.timeSpent),
        createDay: ko.observable(entry.createDay),
        duration: ko.observable(duration),
        raw: entry,
        updateTime: async function(amount) {
            model.loading(true);
            const newTime = this.raw.timeSpent + amount;
            try {
                const payload = { ...this.raw, timeSpent: newTime };
                const updatedEntryData = await model.slingr.put(`/data/${TIME_TRACKING_ENTITY}/${this.id()}`, payload);

                const day = this.day;
                const oldTime = this.raw.timeSpent;

                // Update entry
                this.raw = updatedEntryData;
                this.timeSpent(updatedEntryData.timeSpent);
                this.duration(formatMsToDuration(updatedEntryData.timeSpent));

                // Update day totals
                day.durationMs = day.durationMs - oldTime + updatedEntryData.timeSpent;
                day.duration(formatMsToDuration(day.durationMs));
                day.durationBillableMs = day.durationBillableMs - oldTime + updatedEntryData.timeSpent;
                day.durationBillable(formatMsToDuration(day.durationBillableMs));

                await model.updateStats();
            } catch (e) {
                console.error(e);
                model.addToast('Error updating time entry.', 'error');
            }
            model.loading(false);
        },
        notes: ko.observable(entry.notes),
        day: day,

        // Edit functionality
        edit_project: ko.observable(),
        edit_scope: ko.observable(),
        edit_taskId: ko.observable(),
        edit_ticketId: ko.observable(),
        edit_notes: ko.observable(),
        edit_timeSpent: ko.observable(),
        edit_time: ko.observable(''),
        edit_tasks: ko.observableArray([]),
        edit_tickets: ko.observableArray([]),
        updateEditTimeSpent: function(amount) {
            let current = this.edit_timeSpent();
            let newValue = current + amount;
            if (newValue >= 1800000 && newValue <= 28800000) { // 30m to 8h
                this.edit_timeSpent(newValue);
            }
        },
        updateEditTimeFromInput: function() {
            const ms = parseDurationToMs(this.edit_time());
            if (ms > 0) {
                const roundedMs = Math.round(ms / 1800000) * 1800000;
                const clampedMs = Math.max(1800000, Math.min(roundedMs, 28800000));
                if (this.edit_timeSpent() !== clampedMs) {
                    this.edit_timeSpent(clampedMs);
                } else {
                    this.edit_time(formatMsToDuration(this.edit_timeSpent()));
                }
            } else {
                this.edit_time(formatMsToDuration(this.edit_timeSpent()));
            }
        },

        edit: async (entry) => {
            await entry.initializeEditForm();
            model.openEditEntryModal(entry);
        },

        initializeEditForm: async function() {
            isInitializing = true;
            try {
                const projectObj = model.projects().find(p => p.id === self.raw.project.id);
                self.edit_project(projectObj);
                self.edit_scope(self.scope());
                self.edit_notes(self.notes());
                self.edit_timeSpent(self.timeSpent());

                await self.loadEditScopeOptions();

                if (self.scope() === 'task' && self.raw.task) {
                    self.edit_taskId(self.raw.task.id);
                }
                if (self.scope() === 'supportTicket' && self.raw.ticket) {
                    self.edit_ticketId(self.raw.ticket.id);
                }
            } finally {
                isInitializing = false;
            }
        },

        loadEditScopeOptions: async () => {
            const project = self.edit_project();
            const scope = self.edit_scope();
    
            self.edit_tasks([]);
            self.edit_tickets([]);
    
            if (!project || !scope || scope === 'global') return;
    
            model.loading(true);
            try {
                let entity = '', sort = {}, obs = null;
                if (scope === 'task') {
                    obs = self.edit_tasks;
                    entity = 'dev.tasks';
                    sort = { _sortField: 'createdAt', _sortType: 'desc' };
                } else if (scope === 'supportTicket') {
                    obs = self.edit_tickets;
                    entity = 'support.tickets';
                    sort = { _sortField: 'draftTimestamp', _sortType: 'desc' };
                }
                if (!entity) return;

                const { items } = await model.slingr.get(`/data/${entity}`, {
                    project: project.id, _size: 1000, ...sort, _fields: 'id,label,number',
                });
                obs(items.map(t => ({ id: t.id, name: t.label })));
            } catch (e) {
                console.error('Error loading scope options', e);
                model.addToast('Error loading tasks/tickets', 'error');
            } finally {
                model.loading(false);
            }
        },

        submitEdit: async function() {
            model.loading(true);
            try {
                 const payload = {
                    project: self.edit_project().id,
                    task: self.edit_scope() === 'task' ? self.edit_taskId() : null,
                    ticket: self.edit_scope() === 'supportTicket' ? self.edit_ticketId() : null,
                    timeSpent: parseInt(self.edit_timeSpent()),
                    notes: self.edit_notes(),
                };
                const updatedEntryData = await model.slingr.put(`/data/${TIME_TRACKING_ENTITY}/${self.id()}`, payload);

                const day = self.day;
                const oldTime = self.raw.timeSpent;

                // Update entry
                self.raw = updatedEntryData;
                self.project(updatedEntryData.project.label);
                self.scope(updatedEntryData.task ? 'task' : updatedEntryData.ticket ? 'supportTicket' : 'global');
                self.task(updatedEntryData.task?.label ?? updatedEntryData.ticket?.label ?? 'Global to the project');
                self.timeSpent(updatedEntryData.timeSpent);
                self.duration(formatMsToDuration(updatedEntryData.timeSpent));
                self.notes(updatedEntryData.notes);

                // Update day totals
                day.durationMs = day.durationMs - oldTime + updatedEntryData.timeSpent;
                day.duration(formatMsToDuration(day.durationMs));
                day.durationBillableMs = day.durationBillableMs - oldTime + updatedEntryData.timeSpent;
                day.durationBillable(formatMsToDuration(day.durationBillableMs));

                model.editEntryModal.hide();
                await model.updateStats();
                model.addToast('Entry updated successfully.', 'success');
            } catch (e) {
                console.error(e);
                model.addToast('Error updating entry.', 'error');
            }
            model.loading(false);
        },
        remove: (entry) => {
            model.openRemoveConfirmModal(entry);
        },
    };

    self.scopeColorClass = ko.computed(function() {
        switch(self.scope()) {
            case 'global':
                return 'bg-primary';
            case 'task':
                return 'bg-success';
            case 'supportTicket':
                return 'bg-danger';
            default:
                return 'bg-secondary';
        }
    });

    self.edit_timeSpent.subscribe(val => {
        self.edit_time(formatMsToDuration(val));
    });

    self.edit_project.subscribe(async () => {
        if (isInitializing) return;
        await self.loadEditScopeOptions();
    });
    self.edit_scope.subscribe(async () => {
        if (isInitializing) return;
        self.edit_taskId(null);
        self.edit_ticketId(null);
        await self.loadEditScopeOptions();
    });

    self.isEditLoggable = ko.computed(function() {
        if (!self.edit_project()) return false;
        if (self.edit_scope() === 'task' && !self.edit_taskId()) {
            return false;
        }
        if (self.edit_scope() === 'supportTicket' && !self.edit_ticketId()) {
            return false;
        }
        if (self.edit_notes() && self.edit_notes().trim() === '') {
            return false;
        }
        return true;
    });

    self.scopeClasses = ko.computed(function() {
        let iconClass = '';
        let colorClass = '';
        switch(self.scope()) {
            case 'global':
                iconClass = 'bi-globe-americas';
                colorClass = 'text-primary';
                break;
            case 'task':
                iconClass = 'bi-journal-check';
                colorClass = 'text-success';
                break;
            case 'supportTicket':
                iconClass = 'bi-receipt';
                colorClass = 'text-danger';
                break;
        }
        return `${iconClass} ${colorClass}`;
    });

    return self;
}

/* Date Utils */

function getDateString(date) {
    return date.toISOString().split('T')[0];
}
function formatMsToHours(ms) {
    let n = (ms / 1000 / 60 / 60);
    n = n % 1 === 0 ? n.toString() : n.toFixed(1);
    return n + 'h';
}

/**
 * Transform a duration string like "1h 30m" or "1.5h" to milliseconds.
 * @param {String} durationStr
 * @returns {Number}
 */
function parseDurationToMs(durationStr) {
    if (!durationStr || typeof durationStr !== 'string') return 0;
    let totalMs = 0;
    durationStr = durationStr.trim().toLowerCase();

    const hourMatch = durationStr.match(/(\d*\.?\d+)\s*h/);
    const minMatch = durationStr.match(/(\d+)\s*m/);

    if (hourMatch) {
        totalMs += parseFloat(hourMatch[1]) * 60 * 60 * 1000;
    }
    if (minMatch) {
        totalMs += parseInt(minMatch[1]) * 60 * 1000;
    }

    // If no units, assume hours for a plain number
    if (!hourMatch && !minMatch && !isNaN(parseFloat(durationStr)) && isFinite(durationStr)) {
        totalMs += parseFloat(durationStr) * 60 * 60 * 1000;
    }

    return totalMs;
}

/**
 * Transform a duration in milliseconds to human readable format stepped by 30 minutes
 * @param {Number} ms Milliseconds  
 * @return {String} Output string like 1h or 2h30m
 */
function formatMsToDuration(ms) {
    let hours = Math.floor(ms / 1000 / 60 / 60);
    let minutes = Math.floor((ms / 1000 / 60) % 60);
    let output = '';
    if (hours > 0) {
        output += hours + 'h';
    }
    if (minutes > 0) {
        output += minutes + 'm';
    }
    if (! output) {
        output = '0m';
    }
    return output;
}

function getMsFromHours(hours) {
    return hours * 1000 * 60 * 60;
}

const model = new ViewModel();

// A custom binding for select2
ko.bindingHandlers.select2 = {
    after: ['options', 'value'],
    init: function(element, valueAccessor, allBindings) {
        const $element = $(element);
        const options = ko.unwrap(valueAccessor()) || {};
        $element.select2(options);

        // Handle value changes from the UI
        const value = allBindings.get('value');
        if (ko.isObservable(value)) {
            $element.on('change', function() {
                value($element.val());
            });
        }

        // Handle disposal
        ko.utils.domNodeDisposal.addDisposeCallback(element, function() {
            $element.select2('destroy');
        });
    },
    update: function(element, valueAccessor, allBindings) {
        // This is to make the binding aware of options changes
        ko.unwrap(allBindings.get('options'));

        // The 'after' property should ensure that knockout has updated the options
        // before this update function is called.
        // We can then set the value.
        const $element = $(element);
        const value = allBindings.get('value');
        if (ko.isObservable(value)) {
            $element.val(ko.unwrap(value)).trigger('change.select2');
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    ko.applyBindings(model);
    document.addEventListener('keydown', (e) => {
        model.handleKeyPress(e);
    });

    // Back to top button logic
    const backToTopBtn = document.getElementById("back-to-top-btn");

    if (backToTopBtn) {
        const scrollFunction = () => {
            if (document.body.scrollTop > 100 || document.documentElement.scrollTop > 100) {
                backToTopBtn.style.display = "block";
            } else {
                backToTopBtn.style.display = "none";
            }
        };

        window.addEventListener('scroll', scrollFunction);

        backToTopBtn.addEventListener("click", () => {
            window.scrollTo({top: 0, behavior: 'smooth'});
        });
    }
});