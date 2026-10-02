const TIME_TRACKING_ENTITY = 'timeTracking';

class AuthError extends Error {
    constructor(message) { super(message); this.name = 'AuthError'; }
}

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
            const error = new Error(`[${res.status}] ${res.statusText}`);
            if (res.status === 401) throw new AuthError(error.message);
            throw error;
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

        this.dailyWorkHours = ko.observable(parseInt(localStorage.getItem('solutions:timetracking:dailyWorkHours'), 10) || 8);
        this.dailyWorkHours.subscribe(val => {
            localStorage.setItem('solutions:timetracking:dailyWorkHours', val);
            this.updateDashboard();
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
        this.holidayCache = new Map();
        this.holidaySettingsVersion = 0;
        this.argentinaHolidaysEnabled = ko.observable(localStorage.getItem('solutions:timetracking:argentinaHolidaysEnabled') !== 'false');
        this.argentinaHolidaysEnabled.subscribe(enabled => {
            this.holidaySettingsVersion++;
            localStorage.setItem('solutions:timetracking:argentinaHolidaysEnabled', JSON.stringify(enabled));
            if (!enabled && this.filterHideHolidays) this.filterHideHolidays(false);
            if (this.logged()) this.updateDashboard();
        });
        this.calendar = null;
        this.month = ko.observable(new Date().getMonth());
        this.year = ko.observable(new Date().getFullYear());
        this.selectedMonthLabel = ko.computed(() => new Date(this.year(), this.month(), 1)
            .toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));

        // Time Tracking
        this.weeks = ko.observableArray([]);
        this.projects = ko.observableArray([]);
        this.activeView = ko.observable('daily');
        this.matrixModalTitle = ko.observable('Entries');
        this.matrixModalEntries = ko.observableArray([]);
        this.matrixModalDay = ko.observable(null);
        this.matrixModalProject = ko.observable(null);
        this.projectDayEntriesModal = null;

        // Entry timers (kept locally so they continue across page reloads)
        const storedTimers = (() => {
            try {
                const saved = JSON.parse(localStorage.getItem('solutions:timetracking:activeTimer'));
                const timers = Array.isArray(saved) ? saved : saved ? [{ ...saved, elapsedMs: 0 }] : [];
                return timers.filter(timer => timer.entryId && (timer.startedAt === null || Number.isFinite(timer.startedAt)) && Number.isFinite(timer.elapsedMs) && timer.elapsedMs >= 0);
            } catch (e) {
                return [];
            }
        })();
        this.timerRecords = ko.observableArray(storedTimers);
        this.timerNow = ko.observable(Date.now());
        this.timerStopping = ko.observable(false);
        this.timerPanelMinimized = ko.observable(localStorage.getItem('solutions:timetracking:timerPanelMinimized') === 'true');
        this.timerTickId = setInterval(() => this.timerNow(Date.now()), 1000);
        this.timerPanelMinimized.subscribe(minimized => {
            localStorage.setItem('solutions:timetracking:timerPanelMinimized', JSON.stringify(minimized));
        });
        this.timerRecords.subscribe(timers => {
            if (timers.length) {
                localStorage.setItem('solutions:timetracking:activeTimer', JSON.stringify(timers));
            } else {
                localStorage.removeItem('solutions:timetracking:activeTimer');
            }
        });

        // Filters
        const getStoredFilter = (key, fallback) => {
            try {
                const value = localStorage.getItem(`solutions:timetracking:${key}`);
                return value === null ? fallback : JSON.parse(value);
            } catch (e) {
                return fallback;
            }
        };
        const saveFilter = (key, value) => localStorage.setItem(`solutions:timetracking:${key}`, JSON.stringify(value));
        const asBoolean = (value, fallback) => typeof value === 'boolean' ? value : fallback;
        const storedScopeFilters = getStoredFilter('filterByScope', {}) || {};
        this.filterMissingHours = ko.observable(asBoolean(getStoredFilter('filterMissingHours', false), false));
        this.filterHideLeaveDays = ko.observable(asBoolean(getStoredFilter('filterHideLeaveDays', true), true));
        this.filterHideHolidays = ko.observable(asBoolean(getStoredFilter('filterHideHolidays', false), false));
        this.hideWeekends = ko.observable(asBoolean(getStoredFilter('hideWeekends', true), true));
        this.viewRange = ko.observable(localStorage.getItem('solutions:timetracking:viewRange') || 'month');
        this.preferredView = ko.observable(localStorage.getItem('solutions:timetracking:preferredView') || 'daily');
        this.hiddenProjectIds = ko.observableArray(JSON.parse(localStorage.getItem('solutions:timetracking:hiddenProjects') || '[]'));
        const storedNotesFilter = getStoredFilter('filterByNotes', '');
        const storedProjectFilter = getStoredFilter('filterByProject', null);
        this.filterByNotes = ko.observable(typeof storedNotesFilter === 'string' ? storedNotesFilter : '');
        this.filterByProject = ko.observable(typeof storedProjectFilter === 'string' ? storedProjectFilter : null);
        this.filterByScope = {
            global: ko.observable(asBoolean(storedScopeFilters.global, true)),
            task: ko.observable(asBoolean(storedScopeFilters.task, true)),
            supportTicket: ko.observable(asBoolean(storedScopeFilters.supportTicket, true)),
        };
        this.filterMissingHours.subscribe(value => saveFilter('filterMissingHours', value));
        this.filterHideLeaveDays.subscribe(value => saveFilter('filterHideLeaveDays', value));
        this.filterHideHolidays.subscribe(value => saveFilter('filterHideHolidays', value));
        this.hideWeekends.subscribe(value => saveFilter('hideWeekends', value));
        this.filterByNotes.subscribe(value => saveFilter('filterByNotes', value));
        this.filterByProject.subscribe(value => saveFilter('filterByProject', value));
        Object.values(this.filterByScope).forEach(enabled => {
            enabled.subscribe(value => saveFilter('filterByScope', {
                global: this.filterByScope.global(),
                task: this.filterByScope.task(),
                supportTicket: this.filterByScope.supportTicket(),
            }));
        });

        this.activeFilterChips = ko.computed(() => {
            const chips = [];
            const projectId = this.filterByProject();
            if (projectId) {
                const project = this.projects().find(item => item.id === projectId);
                chips.push({ label: `Project: ${project?.name || 'Selected'}`, clear: () => this.filterByProject(null) });
            }
            if (this.filterByNotes().trim()) {
                chips.push({ label: `Search: ${this.filterByNotes().trim()}`, clear: () => this.filterByNotes('') });
            }
            const scopes = Object.entries(this.filterByScope).filter(([, enabled]) => enabled()).map(([name]) => ({
                global: 'Global', task: 'Task', supportTicket: 'Ticket',
            }[name]));
            if (scopes.length !== 3) {
                chips.push({ label: `Scopes: ${scopes.length ? scopes.join(', ') : 'None'}`, clear: () => {
                    Object.values(this.filterByScope).forEach(enabled => enabled(true));
                } });
            }
            if (this.filterMissingHours()) {
                chips.push({ label: 'Missing hours', clear: () => this.filterMissingHours(false) });
            }
            if (this.filterHideLeaveDays()) {
                chips.push({ label: 'Hiding leave days', clear: () => this.filterHideLeaveDays(false) });
            }
            if (this.filterHideHolidays()) {
                chips.push({ label: 'Hiding holidays', clear: () => this.filterHideHolidays(false) });
            }
            if (this.hideWeekends()) {
                chips.push({ label: 'Hiding weekends', clear: () => this.hideWeekends(false) });
            }
            return chips;
        });
        this.filteredEntryCount = ko.computed(() => this.weeks()
            .flatMap(week => week.days())
            .filter(day => day.isVisible())
            .reduce((count, day) => count + day.filteredEntries().length, 0));
        this.clearAllFilters = () => {
            this.filterByProject(null);
            this.filterByNotes('');
            Object.values(this.filterByScope).forEach(enabled => enabled(true));
            this.filterMissingHours(false);
            this.filterHideLeaveDays(false);
            this.filterHideHolidays(false);
            this.hideWeekends(false);
        };

        // Default project
        this.defaultProject = ko.observable(null);
        this.defaultProject.subscribe(val => {
            if (val) {
                localStorage.setItem('solutions:timetracking:defaultProject', val);
                this.addToast('Default project saved.', 'success');
            } 
        });
        const storedDefaultScope = localStorage.getItem('solutions:timetracking:defaultScope');
        this.defaultScope = ko.observable(['global', 'task', 'supportTicket'].includes(storedDefaultScope) ? storedDefaultScope : 'global');
        this.defaultScope.subscribe(scope => localStorage.setItem('solutions:timetracking:defaultScope', scope));

        this.visibleProjects = ko.computed(() => {
            return this.projects().filter(project => project.isVisible());
        });
        this.projectHoursSummary = ko.computed(() => {
            const totals = this.visibleProjects().map(project => {
                const ms = this.weeks().flatMap(week => week.days())
                    .flatMap(day => day.entries())
                    .filter(entry => !entry.isTodo() && entry.raw?.project?.id === project.id)
                    .reduce((sum, entry) => sum + entry.timeSpent(), 0);
                return { name: project.name, ms };
            }).filter(project => project.ms > 0).sort((a, b) => b.ms - a.ms).slice(0, 5);
            return totals.length
                ? `Project chart, top tracked projects: ${totals.map(project => `${project.name}, ${formatMsToDuration(project.ms)}`).join('; ')}.`
                : 'No project hours logged for this month.';
        });

        this.viewRange.subscribe(val => {
            localStorage.setItem('solutions:timetracking:viewRange', val);
        });
        this.preferredView.subscribe(val => {
            localStorage.setItem('solutions:timetracking:preferredView', val);
            this.activeView(val);
        });
        this.hideWeekends.subscribe(val => {
            localStorage.setItem('solutions:timetracking:hideWeekends', JSON.stringify(val));
        });
        this.filterHideCompleteDays.subscribe(val => {
            localStorage.setItem('solutions:timetracking:hideCompleteDays', JSON.stringify(val));
        });

        this.isCurrentMonth = ko.computed(() => {
            const today = new Date();
            return this.month() === today.getMonth() && this.year() === today.getFullYear();
        });

        this.isCurrentMonth.subscribe(isCurrent => {
            if (!isCurrent && (this.viewRange() === 'day' || this.viewRange() === 'week')) {
                this.viewRange('month');
            }
            if (!isCurrent) {
                this.filterMissingHours(false);
            }
        });

        this.activeView = ko.observable(this.preferredView());

        // Keybindings
        const storedKeybindings = localStorage.getItem('solutions:timetracking:keybindingsEnabled');
        this.keybindingsEnabled = ko.observable(storedKeybindings ? JSON.parse(storedKeybindings) : false);
        this.navigationMode = ko.observable('none'); // 'none', 'day', 'entry'
        this.selectedDay = ko.observable(null);
        this.selectedEntry = ko.observable(null);

        this.visibleDays = ko.computed(() => {
            return this.weeks().map(w => w.days()).flat().filter(d => d.isVisible());
        });

        this.todoEntries = ko.computed(() => {
            return this.weeks()
                .map(week => week.days())
                .flat()
                .map(day => day.filteredEntries())
                .flat()
                .filter(entry => entry.isTodo());
        });

        this.monthlyMatrixRows = ko.computed(() => {
            const projects = this.visibleProjects();
            if (!projects.length) {
                return [];
            }

            return this.weeks().map(w => w.days()).flat().filter(day => {
                if (!day.isVisible()) {
                    return false;
                }

                const hasActiveFilters = this.filterMissingHours() || this.filterHideHolidays() || this.filterByNotes().trim() || this.filterByProject() || !this.filterByScope.global() || !this.filterByScope.task() || !this.filterByScope.supportTicket();
                if (!hasActiveFilters) {
                    return true;
                }

                return day.filteredEntries().length > 0;
            }).map(day => {
                const cells = projects.map(project => {
                    const matchingEntries = day.filteredEntries().filter(entry => !entry.isTodo() && entry.raw?.project?.id === project.id);
                    const ms = matchingEntries.reduce((sum, entry) => sum + entry.raw.timeSpent, 0);
                    return {
                        project,
                        value: ms > 0 ? formatMsToHours(ms) : '0h',
                        ms,
                        cellClass: this.getMatrixCellClass(ms, day),
                        tooltip: `${project.name}: ${ms > 0 ? formatMsToHours(ms) : '0h'}`,
                    };
                });

                const totalMs = cells.reduce((sum, cell) => sum + cell.ms, 0);
                const maxMs = this.dailyWorkHours() * 60 * 60 * 1000;
                const totalProgressVisible = day.isBussinessDay() && totalMs > 0;
                const totalPercentage = totalProgressVisible ? Math.min((totalMs / maxMs) * 100, 100) : 0;
                const totalProgressClass = totalMs <= 0 ? '' : totalMs < maxMs ? 'bg-warning' : totalMs === maxMs ? 'bg-success' : 'bg-danger';

                return {
                    day,
                    dayLabel: this.formatMatrixDayLabel(day),
                    cells,
                    totalMs,
                    totalLabel: formatMsToHours(totalMs),
                    totalCellClass: this.getMatrixCellClass(totalMs, day),
                    totalPercentage,
                    totalProgressVisible,
                    totalProgressClass,
                    rowClass: this.getMatrixRowClass(day),
                };
            });
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

        this.newTodoModal = null;

        this.entryForRemoval = ko.observable(null);
        this.removeConfirmModal = null;

        this.entryForCopy = ko.observable(null);
        this.copyEntryModal = null;
        this.copyEntryCalendar = null;
        this.selectedDateForCopy = ko.observable(null);

        this.entryForMove = ko.observable(null);
        this.moveEntryModal = null;
        this.moveEntryCalendar = null;
        this.selectedDateForMove = ko.observable(null);

        this.entryForCut = ko.observable(null);
        this.entryForPaste = ko.observable(null);

        this.keybindingsHelpModal = null;

        // Pomodoro
        this.pomodoroModal = null;
        this.isPomodoroModalVisible = ko.observable(false);
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
            const removedEntryId = entryToRemove.id();
            const timerWillBeDiscarded = Boolean(this.getTimerFor(removedEntryId));

            this.loading(true);
            try {
                await this.slingr.delete(`/data/${TIME_TRACKING_ENTITY}/${removedEntryId}`);
                this.timerRecords(this.timerRecords().filter(timer => String(timer.entryId) !== String(removedEntryId)));

                const day = entryToRemove.day;
                day.entries.remove(entryToRemove);

                // Update day totals
                day.durationMs(day.durationMs() - entryToRemove.raw.timeSpent);
                day.duration(formatMsToDuration(day.durationMs()));
                day.durationBillableMs(day.durationBillableMs() - entryToRemove.raw.timeSpent);
                day.durationBillable(formatMsToDuration(day.durationBillableMs()));

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

                this.addToast(timerWillBeDiscarded
                    ? 'Entry removed and its timer discarded without logging time.'
                    : 'Entry removed successfully.', 'success');
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

        this.weekDay = ko.observable(new Date().getDay());
        this.date = ko.observable(new Date().toLocaleDateString('en-US', { dateStyle: "medium" }));
    }

    initializeModal = (modalName, elementId, options = {}) => {
        if (this[modalName]) {
            return this[modalName];
        }

        const modalElement = document.getElementById(elementId);
        if (!modalElement) {
            console.error(`Modal element with ID "${elementId}" not found.`);
            return null;
        }

        const modal = new bootstrap.Modal(modalElement);
        this[modalName] = modal;

        modalElement.addEventListener('hide.bs.modal', () => {
            // Prevent accessibility warning by blurring the active element before the modal closes.
            if (document.activeElement) {
                document.activeElement.blur();
            }
            if (options.onHide) {
                options.onHide();
            }
        });

        if (options.onShow) {
            modalElement.addEventListener('show.bs.modal', options.onShow);
        }

        return modal;
    }

    showKeybindingsHelp = () => {
        const modal = this.initializeModal('keybindingsHelpModal', 'keybindingsHelpModal');
        if (modal) modal.show();
    }

    showPomodoroModal = () => {
        if (!this.originalFavicon) {
            const faviconEl = document.getElementById('runtimeAppFavicon');
            if (faviconEl) this.originalFavicon = faviconEl.href;
        }
        const modal = this.initializeModal('pomodoroModal', 'pomodoroModal', {
            onShow: () => this.isPomodoroModalVisible(true),
            onHide: () => this.isPomodoroModalVisible(false)
        });

        // Reset timer if not running
        if (!this.pomodoroIsRunning()) {
            this.pomodoroRemainingTime(this.pomodoroDurationMinutes() * 60);
            this.pomodoroFinished(false);
        }
        if (modal) modal.show();
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
                if (!this.isPomodoroModalVisible()) {
                    this.pomodoroModal.show();
                }
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

    getTimerFor = (entryId) => {
        return this.timerRecords().find(timer => String(timer.entryId) === String(entryId));
    }

    isTimerRunningFor = (entry) => {
        const timer = this.getTimerFor(entry.id());
        return Boolean(timer && timer.startedAt !== null);
    }

    isTimerPausedFor = (entry) => {
        const timer = this.getTimerFor(entry.id());
        return Boolean(timer && timer.startedAt === null);
    }

    hasTimerFor = (entry) => Boolean(this.getTimerFor(entry.id()));

    getTimerDuration = (timer) => {
        const now = this.timerNow();
        const elapsedMs = timer.elapsedMs + (timer.startedAt === null ? 0 : Math.max(0, now - timer.startedAt));
        return formatElapsedTime(elapsedMs);
    }

    getEntryTimerLabel = (entry) => {
        const timer = this.getTimerFor(entry.id());
        return timer ? this.getTimerDuration(timer) : '';
    }

    getTimerEntryLabel = (timer) => {
        const entry = this.weeks()
            .map(week => week.days())
            .flat()
            .flatMap(day => day.entries())
            .find(item => String(item.id()) === String(timer.entryId));
        const notes = String(entry ? entry.notes() || '' : timer.notes || '').trim().replace(/\s+/g, ' ');
        if (!notes) return '(no notes)';
        return notes.length > 40 ? `${notes.slice(0, 40)}…` : notes;
    }

    toggleTimerPanelMinimized = () => this.timerPanelMinimized(!this.timerPanelMinimized());

    replaceTimer = (entryId, update) => {
        this.timerRecords(this.timerRecords().map(timer =>
            String(timer.entryId) === String(entryId) ? { ...timer, ...update } : timer
        ));
    }

    startTimer = (entry) => {
        if (this.getTimerFor(entry.id())) return;
        this.toggleTimerById(entry.id(), entry.notes());
    }

    toggleTimer = (entry) => this.toggleTimerById(entry.id(), entry.notes());

    handleTimerShortcut = (action) => {
        const entry = this.selectedEntry();
        if (!entry) return;
        if (!entry.day.isToday()) {
            this.addToast('Use More actions to manage timers on previous-day entries.', 'info');
            return;
        }
        action(entry);
    }

    toggleTimerById = (entryId, notes = '') => {
        if (this.timerStopping()) return;
        const timer = this.getTimerFor(entryId);
        const now = Date.now();
        if (!timer) {
            this.timerRecords([...this.timerRecords(), { entryId, notes, startedAt: now, elapsedMs: 0 }]);
            this.addToast('Timer started.', 'success');
        } else if (timer.startedAt === null) {
            this.replaceTimer(entryId, { startedAt: now });
            this.addToast('Timer resumed.', 'success');
        } else {
            const elapsedMs = timer.elapsedMs + Math.max(0, now - timer.startedAt);
            this.replaceTimer(entryId, { startedAt: null, elapsedMs });
            this.addToast('Timer paused.', 'info');
        }
    }

    discardTimer = (entryId) => {
        if (this.timerStopping()) return;
        const timer = this.getTimerFor(entryId);
        if (!timer) return;
        this.timerRecords(this.timerRecords().filter(item => String(item.entryId) !== String(entryId)));
        this.addToast('Timer discarded. No time was added.', 'info');
    }

    stopTimer = async (entryId) => {
        const timer = this.getTimerFor(entryId);
        if (!timer || this.timerStopping()) return;

        this.timerStopping(true);
        try {
            const halfHourMs = 30 * 60 * 1000;
            const elapsedMs = timer.elapsedMs + (timer.startedAt === null ? 0 : Math.max(0, Date.now() - timer.startedAt));
            const roundedMs = Math.max(halfHourMs, Math.round(elapsedMs / halfHourMs) * halfHourMs);
            const entry = this.weeks()
                .map(week => week.days())
                .flat()
                .flatMap(day => day.entries())
                .find(item => String(item.id()) === String(timer.entryId));

            if (entry) {
                const updated = await entry.updateTime(roundedMs);
                if (!updated) return;
            } else {
                // The user may have navigated away from the entry's month while the timer was running.
                const currentEntry = await this.slingr.get(`/data/${TIME_TRACKING_ENTITY}/${timer.entryId}`);
                await this.slingr.put(`/data/${TIME_TRACKING_ENTITY}/${timer.entryId}`, {
                    ...currentEntry,
                    timeSpent: (currentEntry.timeSpent || 0) + roundedMs,
                });
            }

            this.timerRecords(this.timerRecords().filter(item => String(item.entryId) !== String(timer.entryId)));
            this.addToast(`Timer stopped. Added ${formatMsToDuration(roundedMs)} to the entry.`, 'success');
        } catch (e) {
            console.error('Error stopping timer:', e);
            this.addToast('Error stopping timer. It is still saved; please try again.', 'error');
        } finally {
            this.timerStopping(false);
        }
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
        // Handle Ctrl+R for full refresh
        if (e.key === 'r' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault(); // Prevent browser's default refresh action
            this.updateDashboard();
            return;
        }

        const isInputFocused = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
 
        if (isInputFocused) {
            if (e.key === 'Escape') {
                document.activeElement.blur();
                e.preventDefault();
            }
            return;
        }

        const isModalOpen = document.body.classList.contains('modal-open');
        if (isModalOpen) {
            const activeModalElement = document.querySelector('.modal.show');
            if (activeModalElement) {
                this.handleModalKeys(e, activeModalElement);
            }
            return;
        }
 
        if (e.key === 'p' && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            this.showPomodoroModal();
            return;
        }

        if (e.key === 'v' && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            this.keybindingsEnabled(!this.keybindingsEnabled());
            return;
        }

        if (!this.keybindingsEnabled()) return;
 
        if (e.key === 'h') {
            e.preventDefault();
            this.showKeybindingsHelp();
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
            case 'h':
                if (modalElement.id === 'pomodoroModal') {
                    e.preventDefault();
                    this.pomodoroModal.hide();
                }
                break;
            case 'r':
                if (modalElement.id === 'pomodoroModal' && this.pomodoroIsRunning()) {
                    e.preventDefault();
                    this.restartPomodoro();
                }
                break;
            case 's':
                if (modalElement.id === 'pomodoroModal' && this.pomodoroIsRunning()) {
                    e.preventDefault();
                    this.stopPomodoro();
                }
                break;
            case 'q':
            case 'Escape':
                e.preventDefault();
                const modal = bootstrap.Modal.getInstance(modalElement);
                if (modal) {
                    modal.hide();
                }
                break;
            case 'Enter':
                if (modalElement.id === 'pomodoroModal' && !this.pomodoroIsRunning()) {
                    e.preventDefault();
                    const startButton = modalElement.querySelector('.modal-footer .btn-success');
                    if (startButton && !startButton.disabled) {
                        startButton.click();
                    }
                    return;
                }
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
            case 'ArrowDown':
                e.preventDefault();
                if (currentIndex < visibleDays.length - 1) {
                    const newDay = visibleDays[currentIndex + 1];
                    this.selectedDay(newDay);
                    this.expandWeekAndScroll(newDay);
                }
                break;
            case 'k':
            case 'ArrowUp':
                e.preventDefault();
                if (currentIndex > 0) {
                    const newDay = visibleDays[currentIndex - 1];
                    this.selectedDay(newDay);
                    this.expandWeekAndScroll(newDay);
                }
                break;
            case 'g':
                e.preventDefault();
                if (visibleDays.length > 0) {
                    this.selectedDay(visibleDays[0]);
                    this.expandWeekAndScroll(this.selectedDay());
                }
                break;
            case 'G':
                e.preventDefault();
                if (visibleDays.length > 0) {
                    this.selectedDay(visibleDays[visibleDays.length - 1]);
                    this.expandWeekAndScroll(this.selectedDay());
                }
                break;
            case 'a':
                e.preventDefault();
                this.openNewEntryModal(this.selectedDay());
                break;
            case 'v':
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    if (this.entryForCut() && this.selectedDay()) {
                        this.movePastedEntry();
                    } else if (this.entryForPaste() && this.selectedDay()) {
                        this.pasteEntry();
                    } else if (!this.entryForPaste() && !this.entryForCut()) {
                        this.addToast('Nothing in clipboard to paste.', 'warning');
                    }
                }
                break;
            case 'Enter':
                e.preventDefault();
                if (this.selectedDay()) {
                    this.navigationMode('entry');
                    if (this.selectedDay().filteredEntries().length > 0) {
                        const firstEntry = this.selectedDay().filteredEntries()[0];
                        this.selectedEntry(firstEntry);
                        this.scrollToEntry(firstEntry);
                    } else {
                        this.selectedEntry(null);
                    }
                }
                break;
            case 't':
                e.preventDefault();
                if (this.selectedDay()) {
                    this.openNewTodoModal(this.selectedDay());
                }
                break;
            case 'T':
                e.preventDefault();
                this.goToToday();
                break;
            case 'r':
                e.preventDefault();
                if (this.selectedDay()) {
                    const day = this.selectedDay();
                    this.loading(true);
                    day.updateDay()
                        .then(() => this.updateStats())
                        .catch((err) => {
                            console.error('Error refreshing day:', err);
                            this.addToast('Failed to refresh day data.', 'error');
                        })
                        .finally(() => this.loading(false));
                } else {
                    this.updateDashboard();
                }
                break;
        }
    }

    handleEntryNavigation = (e) => {
        const currentDay = this.selectedDay();
        if (!currentDay) return;

        const entries = currentDay.filteredEntries();
        let currentIndex = entries.indexOf(this.selectedEntry());

        if (entries.length === 0 && ['e', 'r', '+', '-', 's', 'x', 'd'].includes(e.key.toLowerCase())) {
            e.preventDefault();
            return; // No entries to act on
        }

        switch (e.key) {
            case 'j':
            case 'ArrowDown':
                e.preventDefault();
                if (entries.length > 0 && currentIndex < entries.length - 1) {
                    // Navigate to next entry in the same day
                    this.selectedEntry(entries[currentIndex + 1]);
                    this.scrollToEntry(this.selectedEntry());
                } else {
                    // At last entry or no entries, find next day with entries
                    const visibleDays = this.visibleDays();
                    const currentDayIndex = visibleDays.indexOf(currentDay);
                    for (let i = currentDayIndex + 1; i < visibleDays.length; i++) {
                        const nextDay = visibleDays[i];
                        if (nextDay.filteredEntries().length > 0) {
                            this.selectedDay(nextDay);
                            this.selectedEntry(nextDay.filteredEntries()[0]);
                            this.expandWeekAndScroll(nextDay);
                            this.scrollToEntry(this.selectedEntry());
                            break; // Exit loop
                        }
                    }
                }
                break;
            case 'k':
            case 'ArrowUp':
                e.preventDefault();
                if (entries.length > 0 && currentIndex > 0) {
                    // Navigate to previous entry in the same day
                    this.selectedEntry(entries[currentIndex - 1]);
                    this.scrollToEntry(this.selectedEntry());
                } else {
                    // At first entry or no entries, find previous day with entries
                    const visibleDays = this.visibleDays();
                    const currentDayIndex = visibleDays.indexOf(currentDay);
                    for (let i = currentDayIndex - 1; i >= 0; i--) {
                        const prevDay = visibleDays[i];
                        if (prevDay.filteredEntries().length > 0) {
                            this.selectedDay(prevDay);
                            this.selectedEntry(prevDay.filteredEntries()[prevDay.filteredEntries().length - 1]);
                            this.expandWeekAndScroll(prevDay);
                            this.scrollToEntry(this.selectedEntry());
                            break; // Exit loop
                        }
                    }
                }
                break;
            case 'g':
                e.preventDefault();
                if (entries.length > 0) {
                    this.selectedEntry(entries[0]);
                    this.scrollToEntry(this.selectedEntry());
                }
                break;
            case 'G':
                e.preventDefault();
                if (entries.length > 0) {
                    this.selectedEntry(entries[entries.length - 1]);
                    this.scrollToEntry(this.selectedEntry());
                }
                break;
            case 'q':
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
            case 'v':
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    if (this.entryForCut() && this.selectedDay()) {
                        this.movePastedEntry();
                    } else if (this.entryForPaste() && this.selectedDay()) {
                        this.pasteEntry();
                    } else if (!this.entryForPaste() && !this.entryForCut()) {
                        this.addToast('Nothing in clipboard to paste.', 'warning');
                    }
                }
                break;
            case 'e':
                e.preventDefault();
                if (this.selectedEntry()) {
                    this.selectedEntry().edit(this.selectedEntry());
                }
                break;
            case 's':
                e.preventDefault();
                this.handleTimerShortcut(entry => this.toggleTimer(entry));
                break;
            case 'x':
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    if (this.selectedEntry()) {
                        this.entryForCut(this.selectedEntry());
                        this.entryForPaste(null);
                        this.addToast('Entry cut. Press Ctrl+V on a day to paste.', 'success');
                    }
                } else {
                    e.preventDefault();
                    this.handleTimerShortcut(entry => this.stopTimer(entry.id()));
                }
                break;
            case 'd':
                e.preventDefault();
                this.handleTimerShortcut(entry => this.discardTimer(entry.id()));
                break;
            case 'r':
                e.preventDefault();
                if (this.selectedEntry()) {
                    this.openRemoveConfirmModal(this.selectedEntry());
                }
                break;
            case 'c':
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    if (this.selectedEntry()) {
                        this.entryForPaste(this.selectedEntry());
                        this.entryForCut(null);
                        this.addToast('Entry copied.', 'success');
                    }
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

    setView = (view) => {
        this.activeView(view);
    }

    handleViewTabKeydown = (view, event) => {
        const views = ['daily', 'matrix', 'todo'];
        const currentIndex = views.indexOf(view);
        let nextIndex = currentIndex;
        if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % views.length;
        else if (event.key === 'ArrowLeft') nextIndex = (currentIndex + views.length - 1) % views.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = views.length - 1;
        else return;

        event.preventDefault();
        this.activeView(views[nextIndex]);
        const tabIds = { daily: 'detailsTab', matrix: 'matrixTab', todo: 'todoTab' };
        document.getElementById(tabIds[views[nextIndex]])?.focus();
    }

    showMissingHours = () => {
        this.viewRange('month');
        this.activeView('daily');
        this.filterMissingHours(true);
        const entries = document.getElementById('entries');
        if (entries) entries.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    setViewRange = (range) => {
        if (['month', 'week', 'day'].includes(range)) {
            this.viewRange(range);
        }
    }

    showSettingsModal = () => {
        const modal = this.initializeModal('settingsModal', 'settingsModal');
        if (modal) modal.show();
    }

    logToday = async () => {
        await this.goToToday();
        const todayDateStr = getDateString(new Date());
        const allDays = this.weeks().map(w => w.days()).flat();
        const todayDayObject = allDays.find(d => d.dateStr() === todayDateStr);
        if (todayDayObject) {
            this.selectedDay(todayDayObject);
            this.expandWeekAndScroll(todayDayObject);
            this.openNewEntryModal(todayDayObject);
        }
    }

    openNewTodoToday = async () => {
        await this.goToToday();
        const todayDateStr = getDateString(new Date());
        const allDays = this.weeks().map(w => w.days()).flat();
        const todayDayObject = allDays.find(d => d.dateStr() === todayDateStr);
        if (todayDayObject) {
            this.openNewTodoModal(todayDayObject);
        }
    }

    getMatrixCellClass = (ms, day) => {
        if (!day || day.isLeave() || day.isHoliday()) {
            return 'text-muted';
        }
        if (ms <= 0) {
            return 'text-muted';
        }

        return 'text-success';
    }

    getMatrixRowClass = (day) => {
        if (!day || day.isLeave() || day.isHoliday()) {
            return 'table-secondary';
        }
        if (day.isWeekend()) {
            return 'table-light';
        }
        return '';
    }

    formatMatrixDayLabel = (day) => {
        const date = day.date;
        const weekday = date.toLocaleDateString(undefined, { weekday: 'short' });
        const dayOfMonth = date.getDate();
        const ordinal = dayOfMonth % 10 === 1 && dayOfMonth !== 11 ? 'st' : dayOfMonth % 10 === 2 && dayOfMonth !== 12 ? 'nd' : dayOfMonth % 10 === 3 && dayOfMonth !== 13 ? 'rd' : 'th';
        return `${dayOfMonth}${ordinal} (${weekday})`;
    }

    openProjectDayEntries = (day, project = null) => {
        this.matrixModalDay(day);
        this.matrixModalProject(project);

        const filteredEntries = day.filteredEntries().filter(entry => !entry.isTodo() && (!project || entry.raw?.project?.id === project.id));
        this.matrixModalEntries(filteredEntries);

        const projectLabel = project ? ` - ${project.name}` : '';
        this.matrixModalTitle(`${day.title}${projectLabel}`);

        this.projectDayEntriesModal = this.initializeModal('projectDayEntriesModal', 'projectDayEntriesModal');
        if (this.projectDayEntriesModal) this.projectDayEntriesModal.show();
    }

    openMatrixDayForEntry = (day, project = null) => {
        let selectedProject = null;
        if (project) {
            selectedProject = this.projects().find(p => p.id === project.id) || null;
        }
        this.openNewEntryModal(day, selectedProject);
    }

    addEntryFromMatrixModal = () => {
        const day = this.matrixModalDay();
        if (!day) return;

        const project = this.matrixModalProject();
        let selectedProject = null;
        if (project) {
            selectedProject = this.projects().find(p => p.id === project.id) || null;
        }

        if (this.projectDayEntriesModal) {
            this.projectDayEntriesModal.hide();
        }
        this.openNewEntryModal(day, selectedProject);
    }

    openNewEntryModal = (day, project = null) => {
        this.selectedDayForNewEntry(day);

        // Prefer an explicit project, then the active filter, then the default.
        const projectId = project?.id || this.filterByProject() || this.defaultProject();
        const selectedProject = this.projects().find(project => project.id === projectId);
        if (day && selectedProject) {
            day.project(selectedProject);
        }

        const modal = this.initializeModal('newEntryModal', 'newEntryModal', {
            onShown: () => {
                const currentDay = this.selectedDayForNewEntry();
                const firstRequiredField = currentDay?.project()
                    ? document.querySelector('#newEntryModal textarea[name="notes"]')
                    : document.querySelector('#newEntryModal select[aria-label="Project"]');
                firstRequiredField?.focus();
            },
        });
        if (modal) modal.show();
    }

    openNewTodoModal = (day) => {
        this.selectedDayForNewEntry(day);
        const projectId = this.filterByProject() || this.defaultProject();
        const selectedProject = this.projects().find(project => project.id === projectId);
        if (day && selectedProject) day.project(selectedProject);
        const modal = this.initializeModal('newTodoModal', 'newTodoModal', {
            onShown: () => {
                const currentDay = this.selectedDayForNewEntry();
                const firstRequiredField = currentDay?.project()
                    ? document.querySelector('#newTodoModal textarea[name="notes"]')
                    : document.querySelector('#newTodoModal select[aria-label="Project"]');
                firstRequiredField?.focus();
            },
        });
        if (modal) modal.show();
    }

    openEditEntryModal = (entry) => {
        this.selectedEntryForEdit(entry);
        const modal = this.initializeModal('editEntryModal', 'editEntryModal', {
            onShown: () => document.querySelector('#editEntryModal textarea[name="notes"]')?.focus(),
        });
        if (modal) modal.show();
    }

    openMoveEntryModal = (entry) => {
        this.entryForMove(entry);
        this.selectedDateForMove(null); // Reset selected date
        const modal = this.initializeModal('moveEntryModal', 'moveEntryModal', {
            onShow: () => {
                if (!this.moveEntryCalendar) {
                    this.moveEntryCalendar = new VanillaCalendarPro.Calendar('#move-entry-calendar', {
                        onClickDate: (calendar, event) => {
                            this.selectedDateForMove(calendar.context.selectedDates[0]);
                        },
                        selectionDatesMode: 'single',
                        selectedTheme: this.theme(),
                        disableWeekdays: [0, 6],
                    });
                    this.moveEntryCalendar.init();
                } else {
                    this.moveEntryCalendar.set({
                        selectedDates: [],
                        selectedMonth: new Date().getMonth(),
                        selectedYear: new Date().getFullYear(),
                    });
                }
            }
        });
        if (modal) modal.show();
    }

    openCopyEntryModal = (entry) => {
        this.entryForCopy(entry);
        this.selectedDateForCopy(null); // Reset selected date
        const modal = this.initializeModal('copyEntryModal', 'copyEntryModal', {
            onShow: () => {
                if (!this.copyEntryCalendar) {
                    this.copyEntryCalendar = new VanillaCalendarPro.Calendar('#copy-entry-calendar', {
                        onClickDate: (calendar, event) => {
                            this.selectedDateForCopy(calendar.context.selectedDates[0]);
                        },
                        selectionDatesMode: 'single',
                        selectedTheme: this.theme(),
                        disableWeekdays: [0, 6],
                    });
                    this.copyEntryCalendar.init();
                } else {
                    this.copyEntryCalendar.set({
                        selectedDates: [],
                        selectedMonth: new Date().getMonth(),
                        selectedYear: new Date().getFullYear(),
                    });
                }
            }
        });
        if (modal) modal.show();
    }

    submitMove = async () => {
        const entryToMove = this.entryForMove();
        const targetDate = this.selectedDateForMove();

        if (!entryToMove || !targetDate) return;

        const originalDate = entryToMove.day.dateStr();
        if (originalDate === targetDate) {
            this.addToast('Entry is already on this day.', 'info');
            this.moveEntryModal.hide();
            return;
        }

        this.loading(true);
        try {
            const payload = { ...entryToMove.raw, date: targetDate };
            await this.slingr.put(`/data/${TIME_TRACKING_ENTITY}/${entryToMove.id()}`, payload);

            this.addToast(`Entry moved to ${targetDate}`, 'success');
            this.moveEntryModal.hide();

            // Remove from old day
            const originalDay = entryToMove.day;
            originalDay.entries.remove(entryToMove);
            originalDay.durationMs(originalDay.durationMs() - entryToMove.raw.timeSpent);
            originalDay.duration(formatMsToDuration(originalDay.durationMs()));
            originalDay.durationBillableMs(originalDay.durationBillableMs() - entryToMove.raw.timeSpent);
            originalDay.durationBillable(formatMsToDuration(originalDay.durationBillableMs()));

            // Refresh new day if visible
            const targetDateObj = new Date(targetDate + 'T00:00:00');
            if (targetDateObj.getMonth() === this.month() && targetDateObj.getFullYear() === this.year()) {
                const allDays = this.weeks().map(w => w.days()).flat();
                const targetDay = allDays.find(d => d.dateStr() === targetDate);
                if (targetDay) {
                    await targetDay.updateDay();
                }
            }

            await this.updateStats();
        } catch (e) {
            console.error('Error moving entry:', e);
            this.addToast('Error moving entry.', 'error');
        } finally {
            this.loading(false);
            this.entryForMove(null);
            this.selectedDateForMove(null);
        }
    }

    submitCopy = async () => {
        const entryToCopy = this.entryForCopy();
        const targetDate = this.selectedDateForCopy();

        if (!entryToCopy || !targetDate) return;

        this.loading(true);
        try {
            const payload = {
                project: entryToCopy.raw.project.id,
                scope: entryToCopy.scope(),
                task: entryToCopy.scope() === 'task' ? entryToCopy.raw.task.id : null,
                ticket: entryToCopy.scope() === 'supportTicket' ? entryToCopy.raw.ticket.id : null,
                forMe: true,
                date: targetDate,
                timeSpent: entryToCopy.raw.timeSpent,
                notes: entryToCopy.notes(),
            };

            await this.slingr.put(`/data/${TIME_TRACKING_ENTITY}/logTime`, payload);

            this.addToast(`Entry copied to ${targetDate}`, 'success');
            this.copyEntryModal.hide();

            const targetDateObj = new Date(targetDate + 'T00:00:00');
            if (targetDateObj.getMonth() === this.month() && targetDateObj.getFullYear() === this.year()) {
                const allDays = this.weeks().map(w => w.days()).flat();
                const targetDay = allDays.find(d => d.dateStr() === targetDate);
                if (targetDay) {
                    await targetDay.updateDay();
                    await this.updateStats();
                } else {
                    // Fallback for safety, though it shouldn't be reached if the day is in the current view
                    await this.updateDashboard();
                }
            }
        } catch (e) {
            console.error('Error copying entry:', e);
            this.addToast('Error copying entry.', 'error');
        } finally {
            this.loading(false);
            this.entryForCopy(null);
            this.selectedDateForCopy(null);
        }
    }

    movePastedEntry = async () => {
        const entryToMove = this.entryForCut();
        const targetDay = this.selectedDay();

        if (!entryToMove || !targetDay) return;

        const targetDate = targetDay.dateStr();
        const originalDay = entryToMove.day;

        if (originalDay.dateStr() === targetDate) {
            this.addToast('Entry is already on this day.', 'info');
            this.entryForCut(null);
            return;
        }

        this.loading(true);
        try {
            const payload = { ...entryToMove.raw, date: targetDate };
            await this.slingr.put(`/data/${TIME_TRACKING_ENTITY}/${entryToMove.id()}`, payload);

            this.addToast(`Entry moved to ${targetDate}`, 'success');

            // Remove from old day
            originalDay.entries.remove(entryToMove);
            originalDay.durationMs(originalDay.durationMs() - entryToMove.raw.timeSpent);
            originalDay.duration(formatMsToDuration(originalDay.durationMs()));
            originalDay.durationBillableMs(originalDay.durationBillableMs() - entryToMove.raw.timeSpent);
            originalDay.durationBillable(formatMsToDuration(originalDay.durationBillableMs()));

            // Refresh new day
            await targetDay.updateDay();

            await this.updateStats();

            this.entryForCut(null);

        } catch (e) {
            console.error('Error moving entry:', e);
            this.addToast('Error moving entry.', 'error');
        } finally {
            this.loading(false);
        }
    }

    pasteEntry = async () => {
        const entryToCopy = this.entryForPaste();
        const targetDay = this.selectedDay();

        if (!entryToCopy || !targetDay) return;

        const targetDate = targetDay.dateStr();

        this.loading(true);
        try {
            const payload = {
                project: entryToCopy.raw.project.id,
                scope: entryToCopy.scope(),
                task: entryToCopy.scope() === 'task' ? entryToCopy.raw.task.id : null,
                ticket: entryToCopy.scope() === 'supportTicket' ? entryToCopy.raw.ticket.id : null,
                forMe: true,
                date: targetDate,
                timeSpent: entryToCopy.raw.timeSpent,
                notes: entryToCopy.notes(),
            };

            await this.slingr.put(`/data/${TIME_TRACKING_ENTITY}/logTime`, payload);

            this.addToast(`Entry pasted to ${targetDate}`, 'success');

            await targetDay.updateDay();
            await this.updateStats();

        } catch (e) {
            console.error('Error pasting entry:', e);
            this.addToast('Error pasting entry.', 'error');
        } finally {
            this.loading(false);
        }
    }

    openRemoveConfirmModal = (entry) => {
        this.entryForRemoval(entry);
        const modal = this.initializeModal('removeConfirmModal', 'removeConfirmModal');
        if (modal) modal.show();
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
        if (!this.logged() || !this.slingr.user) return;
        if (this.dashboardRefreshPromise) {
            this.dashboardRefreshPending = true;
            return this.dashboardRefreshPromise;
        }

        this.dashboardLoading(true);
        this.loading(true);
        this.statsWarning('');

        this.dashboardRefreshPromise = (async () => {
            try {
                do {
                    this.dashboardRefreshPending = false;
                    this.dashboardRefreshSequence++;
                    this.statsWarning('');
                    try {
                        await this.updateHolidays();
                    } catch (error) {
                        console.warn('Holiday data could not be refreshed:', error);
                        if (this.argentinaHolidaysEnabled()) {
                            this.holidayWarning('Argentina holiday data could not be loaded; missing-hours totals may include public holidays.');
                        }
                    }

                    try {
                        await this.updateTimeTracking();
                        this.lastUpdatedAt(new Date());
                    } catch (e) {
                        if (e instanceof AuthError) {
                            console.warn('Dashboard refresh stopped because the session expired:', e);
                            this.logout(false);
                            this.addToast('Your session expired. Please log in again.', 'warning');
                            break;
                        }
                        console.error('Dashboard refresh attempt failed:', e);
                    }
                } while (this.dashboardRefreshPending && this.logged() && this.slingr.user);
            } catch (error) {
                console.error('Dashboard refresh failed unexpectedly:', error);
            } finally {
                this.dashboardLoading(false);
                this.loading(false);
                this.dashboardRefreshPromise = null;
            }

        })();
        return this.dashboardRefreshPromise;
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
        const settingsVersion = this.holidaySettingsVersion;
        const year = this.year();
        const month = this.month();
        const applyLeaveDaysOnly = () => {
            this.holidays([]);
            this.calendar?.set?.({ selectedHolidays: this.leaveDays() });
            this.holidayWarning('');
        };
        if (!this.argentinaHolidaysEnabled()) {
            applyLeaveDaysOnly();
            return;
        }

        try {
            if (!this.holidayCache.has(year)) {
                const response = await fetch(`https://api.argentinadatos.com/v1/feriados/${year}`);
                if (!response.ok) throw new Error(`Holiday API returned ${response.status}`);
                const items = await response.json();
                if (!Array.isArray(items)) throw new Error('Unexpected holiday API response');
                this.holidayCache.set(year, items);
            }
            if (settingsVersion !== this.holidaySettingsVersion || year !== this.year() || month !== this.month()) return;
            if (!this.argentinaHolidaysEnabled()) {
                applyLeaveDaysOnly();
                return;
            }
            const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
            const holidays = this.holidayCache.get(year)
                .filter(item => item.fecha?.startsWith(monthPrefix) && item.nombre)
                .map(item => ({ day: item.fecha, title: item.nombre, label: item.nombre }));
            this.holidays(holidays);
            this.calendar?.set?.({ selectedHolidays: [...holidays.map(item => item.day), ...this.leaveDays()] });
            this.holidayWarning('');
        } catch (e) {
            if (settingsVersion !== this.holidaySettingsVersion || year !== this.year() || month !== this.month()) return;
            if (!this.argentinaHolidaysEnabled()) {
                applyLeaveDaysOnly();
                return;
            }
            console.warn('Could not load holiday data:', e);
            this.holidays([]);
            this.calendar?.set?.({ selectedHolidays: this.leaveDays() });
            this.holidayWarning('Argentina holiday data could not be loaded; missing-hours totals may include public holidays.');
        }
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
        let totalMonthMs = this.weeks().map(w => w.days()).flat().filter(d => d.isBussinessDay()).length * this.dailyWorkHours() * 60 * 60 * 1000;
        if (totalMonthMs === 0) totalMonthMs = 1; // Avoid division by zero
        const todayStr = getDateString(new Date());
        let expectedMtdMs = this.weeks().map(w => w.days()).flat().filter(d => d.isBussinessDay() && d.dateStr() <= todayStr).length * this.dailyWorkHours() * 60 * 60 * 1000;
        let entries = this.weeks().map(w => w.days()).flat().map(d => d.entries()).flat().filter(e => !e.isTodo());
 
        const scopeStats = {
            global: { timeSpent: 0, color: 'rgb(13, 110, 253)', name: 'Global' },
            task: { timeSpent: 0, color: 'rgb(25, 135, 84)', name: 'Task' },
            supportTicket: { timeSpent: 0, color: 'rgb(220, 53, 69)', name: 'Ticket' },
        };
 
        let totalTimeSpent = 0;
        let totalTimeSpentMtd = 0;
        for (const entry of entries) {
            const scope = entry.scope();
            if (scopeStats[scope]) {
                scopeStats[scope].timeSpent += entry.raw.timeSpent;
            }
            totalTimeSpent += entry.raw.timeSpent;

            if (entry.day.dateStr() <= todayStr) {
                totalTimeSpentMtd += entry.raw.timeSpent;
            }
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

        const missingMs = expectedMtdMs - totalTimeSpentMtd;
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

        const hiddenIds = this.hiddenProjectIds();
        const mappedProjects = projects.map(p => {
            const project = {
                id: p.id,
                name: p.label,
                shortName: p.label.length > 15 ? `${p.label.slice(0, 15)}…` : p.label,
                isVisible: ko.observable(!hiddenIds.includes(p.id)),
            };

            project.isVisible.subscribe(isVisible => {
                const currentHidden = this.hiddenProjectIds().slice();
                const exists = currentHidden.indexOf(project.id);
                if (!isVisible && exists === -1) {
                    currentHidden.push(project.id);
                }
                if (isVisible && exists !== -1) {
                    currentHidden.splice(exists, 1);
                }
                this.hiddenProjectIds(currentHidden);
                localStorage.setItem('solutions:timetracking:hiddenProjects', JSON.stringify(currentHidden));

                if (!isVisible && this.filterByProject() === project.id) {
                    this.filterByProject(null);
                }
                this.updateStats();
            });

            return project;
        });

        this.projects(mappedProjects);

        // Set default project if it's not set and there is one in localStorage
        if (!this.defaultProject()) {
            const storedDefaultProject = localStorage.getItem('solutions:timetracking:defaultProject');
            if (storedDefaultProject) this.defaultProject(storedDefaultProject);
        }
 
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
 
        const visibleProjects = this.visibleProjects();
        for (let project of visibleProjects) {
            let projectEntries = this.weeks()
                .map(w => w.days()).flat()
                .map(d => d.entries()).flat()
                .filter(e => e.raw.project.id === project.id)
                .filter(e => !e.isTodo());
 
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
                name: project.name,
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
                    if (!day.isVisible() || day.filteredEntries().length === 0) return;
                    day.filteredEntries().forEach(entry => {
                        const sanitize = (str) => (str || '').replace(/"/g, '""').replace(/\r?\n/g, ' ');
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

    self.filteredDays = ko.computed(function() {
        return self.days().filter(day => {
            if (!day.isVisible()) {
                return false;
            }
            // If notes filter is active, only show day if it has matching entries
            if (model.filterByNotes().trim() !== '') {
                return day.filteredEntries().length > 0;
            }
            return true;
        });
    });

    self.toggleCollapse = function() {
        self.isCollapsed(!self.isCollapsed());
    };

    self.isVisible = ko.computed(function() {
        return self.days().some(d => d.isVisible());
    });

    return self;
}

function Day (date, entries, week) {
    const getMaxTimeSpent = () => model.dailyWorkHours() * 60 * 60 * 1000;
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
        durationMs: ko.observable(0),
        durationBillableMs: ko.observable(0),
        durationNonBillable: 0,
        visibleNotes: ko.observable(true),
        // Form
        scope: ko.observable(model.defaultScope()),
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
            this.durationMs(0);
            this.durationBillableMs(0);

            for (let entry of entries) {
                let entryDate = new Entry(entry, this);
                this.durationMs(this.durationMs() + entryDate.raw.timeSpent);
                this.durationBillableMs(this.durationBillableMs() + entry.timeSpent);
                this.entries.push(entryDate);
            }
            this.duration(formatMsToDuration(this.durationMs()));
            this.durationBillable(formatMsToDuration(this.durationBillableMs()));
        },
        updateTimeSpentInModal: function(amount) {
            let current = this.timeSpent();
            let newValue = current + amount;
            if (newValue >= 1800000 && newValue <= getMaxTimeSpent()) { // 30m to dynamic max
                this.timeSpent(newValue);
            }
        },
        updateTimeFromInput: function() {
            const ms = parseDurationToMs(this.time());
            if (ms > 0) {
                const roundedMs = Math.round(ms / 1800000) * 1800000;
                const clampedMs = Math.max(1800000, Math.min(roundedMs, getMaxTimeSpent()));
                if (this.timeSpent() !== clampedMs) {
                    this.timeSpent(clampedMs);
                } else {
                    this.time(formatMsToDuration(this.timeSpent()));
                }
            } else {
                this.time(formatMsToDuration(this.timeSpent()));
            }
        },
        logTodo: async (day) => {
            model.loading(true);
            try {
                // Ensure project is selected before logging
                if (!day.project()) {
                    model.addToast('Please select a project.', 'error');
                    model.loading(false);
                    return;
                }

                await model.slingr.put(`/data/${TIME_TRACKING_ENTITY}/logTime`, {
                    project: day.project().id,
                    scope: 'global',
                    forMe: true,
                    date: day.dateStr(),
                    timeSpent: 0,
                    notes: day.notes(),
                });

                await day.updateDay();

                day.notes('');

                model.newTodoModal.hide();
                await model.updateStats();
                model.addToast('To-Do item added.', 'success');
            } catch(e) {
                console.error(e);
                model.addToast('Error logging To-Do.', 'error');
            }
            model.loading(false);
        },
        taskId: ko.observable(null),
        ticketId: ko.observable(null),
        tasks: ko.observableArray([]),
        taskStatusFilter: ko.observable('all'),
        taskStatusOptions: [
            { value: 'all', text: 'All' },
            { value: 'new', text: 'New' },
            { value: 'toDo', text: 'To Do' },
            { value: 'inProgress', text: 'In Progress' },
            { value: 'inReview', text: 'In Review' },
            { value: 'completed', text: 'Completed' },
            { value: 'staging', text: 'Staging' },
            { value: 'released', text: 'Released' }
        ],
        tickets: ko.observableArray([]),
        onlyAssignedToMe: ko.observable(true),
        toggleLeave: async (day) => {
            const dateStr = day.dateStr();
            model.loading(true);
            try {
                if (model.leaveDays.indexOf(dateStr) > -1) {
                    model.leaveDays.remove(dateStr);
                } else {
                    model.leaveDays.push(dateStr);
                }
                await model.updateStats();
            } finally {
                model.loading(false);
            }
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
                day.scope(model.defaultScope()); // Keep the chosen default for the next entry.
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

    day.fillMissingHours = function() {
        day.timeSpent(getMaxTimeSpent() - day.durationMs());
        day.notes('-');
        model.openNewEntryModal(day);
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

    day.isTodoLoggable = ko.computed(function() {
        if (!day.project()) {
            return false;
        }
        if (day.notes().trim() === '') {
            return false;
        }
        return true;
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

    day.newEntryTargetWarning = ko.computed(function() {
        const targetMs = getMaxTimeSpent();
        const projectedMs = day.durationMs() + day.timeSpent();
        if (projectedMs <= targetMs) return '';
        return `If logged, this would bring the day to ${formatMsToDuration(projectedMs)}, ${formatMsToDuration(projectedMs - targetMs)} above the ${model.dailyWorkHours()}h daily target.`;
    });

    day.filteredEntries = ko.computed(function() {
        let entries = day.entries();

        // Filter by scope
        const scopeFilters = model.filterByScope;
        if (!scopeFilters.global() || !scopeFilters.task() || !scopeFilters.supportTicket()) {
            entries = entries.filter(entry => {
                const scope = entry.scope(); // 'global', 'task', 'supportTicket'
                return scopeFilters[scope] && scopeFilters[scope]();
            });
        }

        // Filter by project
        const projectId = model.filterByProject();
        if (projectId) {
            entries = entries.filter(entry => entry.raw.project.id === projectId);
        }

        const filterText = model.filterByNotes().trim().toLowerCase();
        if (filterText) {
            const filterTerms = filterText.split(',').map(term => term.trim()).filter(term => term);
            entries = entries.filter(entry => {
                const notes = (entry.notes() || '').toLowerCase();
                return filterTerms.some(term => notes.includes(term));
            });
        }
        return entries;
    });

    // Set default project if available
    ko.computed(() => {
        if (day.project() === null && model.projects().length > 0 && model.defaultProject()) {
            const defaultProjectId = model.defaultProject();
            if (defaultProjectId) {
                const defaultProject = model.projects().find(p => p.id === defaultProjectId);
                if (defaultProject) {
                    day.project(defaultProject);
                }
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
            let params = {
                project: project.id,
                _size: 1000,
                ...sort,
                _fields: 'id,label,number',
            };
            if (day.onlyAssignedToMe()) {
                if (entity === 'dev.tasks') {
                    params.assignees = model.slingr.user.id;
                } else if (entity === 'support.tickets') {
                    params.assignee = model.slingr.user.id;
                }
            }
            if (scope === 'task' && day.taskStatusFilter() !== 'all') {
                params.status = day.taskStatusFilter();
            }
            const { items } = await model.slingr.get(`/data/${entity}`, params);
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
        model.defaultScope(day.scope());
        day.taskId(null);
        day.ticketId(null);
        await loadScopeOptions();
    });
    day.taskStatusFilter.subscribe(async () => {
        await loadScopeOptions();
    });
    day.onlyAssignedToMe.subscribe(async () => {
        day.taskId(null);
        day.ticketId(null);
        await loadScopeOptions();
    });

    for (let entry of entries) {
        if (entry.date !== dateStr) continue;
        let entryDate = new Entry(entry, day);

        day.durationMs(day.durationMs() + entryDate.raw.timeSpent);
        day.durationBillableMs(day.durationBillableMs() + entry.timeSpent);
        day.entries.push(entryDate);
    }
    day.duration = ko.observable(formatMsToDuration(day.durationMs()));
    day.durationBillable = ko.observable(formatMsToDuration(day.durationBillableMs()));
    day.durationNonBillable = ko.observable(formatMsToDuration(day.durationNonBillable));

    day.isMissingTime = ko.computed(function() {
        const todayStr = getDateString(new Date());
        return day.isBussinessDay() && day.dateStr() <= todayStr && day.durationMs() < getMaxTimeSpent();
    });
    day.missingDuration = ko.computed(function() {
        return day.isMissingTime() ? formatMsToDuration(getMaxTimeSpent() - day.durationMs()) : null;
    });

    day.isVisible = ko.computed(function() {
        const range = model.viewRange();
        const today = new Date();
        const todayStr = getDateString(today);

        if (range === 'day' && !day.isToday()) {
            return false;
        }

        if (range === 'week') {
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
        if (model.filterHideHolidays() && day.isHoliday()) {
            return false;
        }
        if (model.filterMissingHours() && !day.isMissingTime()) {
            return false;
        }
        if (model.hideWeekends() && day.isWeekend() && !day.isLeave()) {
            return false;
        }
        if (model.filterHideCompleteDays()) {
            if (day.dateStr() > todayStr) {
                return false;
            }
            if (day.isBussinessDay() && day.durationMs() >= getMaxTimeSpent()) {
                return false;
            }
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
        if (!day.isBussinessDay() || day.durationMs() <= 0) {
            return 0;
        }
        const percentage = (day.durationMs() / getMaxTimeSpent()) * 100;
        return Math.min(percentage, 100);
    });

    day.durationScopes = ko.computed(function() {
        const scopeDetails = {
            global: { name: 'Global', colorClass: 'bg-primary', timeSpent: 0 },
            task: { name: 'Task', colorClass: 'bg-success', timeSpent: 0 },
            supportTicket: { name: 'Ticket', colorClass: 'bg-danger', timeSpent: 0 },
        };
        const totalTime = day.durationMs();
        if (totalTime <= 0) {
            return [];
        }

        for (const entry of day.entries()) {
            const scope = entry.scope();
            if (scopeDetails[scope]) {
                scopeDetails[scope].timeSpent += entry.timeSpent();
            }
        }

        return Object.values(scopeDetails)
            .filter(scope => scope.timeSpent > 0)
            .map(scope => ({
                ...scope,
                duration: formatMsToDuration(scope.timeSpent),
                width: `${(scope.timeSpent / totalTime) * 100}%`,
            }));
    });

    day.durationScopeSummary = ko.computed(function() {
        const scopeSummary = day.durationScopes().map(scope => `${scope.name}: ${scope.duration}`);
        return [day.duration() + ' logged', ...scopeSummary].join(' · ');
    });

    day.durationClass = ko.computed(function() {
        const percentage = (day.durationMs() / getMaxTimeSpent()) * 100;
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
                day.durationMs(day.durationMs() - oldTime + updatedEntryData.timeSpent);
                day.duration(formatMsToDuration(day.durationMs()));
                day.durationBillableMs(day.durationBillableMs() - oldTime + updatedEntryData.timeSpent);
                day.durationBillable(formatMsToDuration(day.durationBillableMs()));

                await model.updateStats();
                return true;
            } catch (e) {
                console.error(e);
                model.addToast('Error updating time entry.', 'error');
                return false;
            } finally {
                model.loading(false);
            }
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
        edit_taskStatusFilter: ko.observable('all'),
        edit_taskStatusOptions: [
            { value: 'all', text: 'All' },
            { value: 'new', text: 'New' },
            { value: 'toDo', text: 'To Do' },
            { value: 'inProgress', text: 'In Progress' },
            { value: 'inReview', text: 'In Review' },
            { value: 'completed', text: 'Completed' },
            { value: 'staging', text: 'Staging' },
            { value: 'released', text: 'Released' }
        ],
        edit_onlyAssignedToMe: ko.observable(false),

        updateEditTimeSpent: function(amount) {
            let current = this.edit_timeSpent();
            let newValue = current + amount;
            if (newValue >= 1800000 && newValue <= model.dailyWorkHours() * 60 * 60 * 1000) {
                this.edit_timeSpent(newValue);
            }
        },
        updateEditTimeFromInput: function() {
            const ms = parseDurationToMs(this.edit_time());
            if (ms > 0) {
                const roundedMs = Math.round(ms / 1800000) * 1800000;
                const clampedMs = Math.max(1800000, Math.min(roundedMs, model.dailyWorkHours() * 60 * 60 * 1000));
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
                
                let params = {
                    project: project.id, _size: 1000, ...sort, _fields: 'id,label,number',
                };
                if (self.edit_onlyAssignedToMe()) {
                    if (entity === 'dev.tasks') {
                        params.assignees = model.slingr.user.id;
                    } else if (entity === 'support.tickets') {
                        params.assignee = model.slingr.user.id;
                    }
                }
                if (scope === 'task' && self.edit_taskStatusFilter() !== 'all') {
                    params.status = self.edit_taskStatusFilter();
                }

                const { items } = await model.slingr.get(`/data/${entity}`, params);
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
                day.durationMs(day.durationMs() - oldTime + updatedEntryData.timeSpent);
                day.duration(formatMsToDuration(day.durationMs()));
                day.durationBillableMs(day.durationBillableMs() - oldTime + updatedEntryData.timeSpent);
                day.durationBillable(formatMsToDuration(day.durationBillableMs()));

                model.editEntryModal.hide();
                await model.updateStats();
                model.addToast('Entry updated successfully.', 'success');
            } catch (e) {
                console.error(e);
                model.addToast('Error updating entry.', 'error');
            }
            model.loading(false);
        },
        confirmTodo: async function() {
            // Open the edit modal to confirm the To-Do
            await this.initializeEditForm();
            // Pre-fill with 1 hour
            this.edit_timeSpent(1 * 60 * 60 * 1000);
            model.openEditEntryModal(this);
        },
        remove: (entry) => {
            model.openRemoveConfirmModal(entry);
        },
        copy: (entry) => {
            model.openCopyEntryModal(entry);
        },
        move: (entry) => {
            model.openMoveEntryModal(entry);
        },
    };

    self.editTargetWarning = ko.computed(function() {
        const targetMs = model.dailyWorkHours() * 60 * 60 * 1000;
        const projectedMs = self.day.durationMs() - self.raw.timeSpent + self.edit_timeSpent();
        if (!Number.isFinite(projectedMs) || projectedMs <= targetMs) return '';
        return `After saving, the day's total would be ${formatMsToDuration(projectedMs)}, ${formatMsToDuration(projectedMs - targetMs)} above the ${model.dailyWorkHours()}h daily target.`;
    });

    self.labels = ko.computed(function() {
        const notesText = self.notes() || '';
        const matches = notesText.match(/#\w+/g) || [];
        return matches.map(label => label.substring(1));
    });

    self.formattedNotes = ko.computed(function() {
        const notesText = self.notes() || '';
        return notesText.replace(/#(\w+)/g, (match, word) => {
            return `<span class="badge bg-secondary text-dark me-1">#${word}</span>`;
        });
    });

    self.isTodo = ko.computed(function() {
        return self.timeSpent() === 0;
    });

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
    self.edit_taskStatusFilter.subscribe(async () => {
        if (isInitializing) return;
        await self.loadEditScopeOptions();
    });

    self.edit_onlyAssignedToMe.subscribe(async () => {
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
        if (self.isTodo()) {
            return 'bi-check2-square text-secondary';
        }
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

function formatElapsedTime(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
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
                backToTopBtn.style.display = "flex";
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
