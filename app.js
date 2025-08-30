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

        // Login
        this.email = ko.observable(null);
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
                console.log('Logged in as', user?.id);
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
        this.days = ko.observableArray([]);
        this.projects = ko.observableArray([]);
        this.showWeekends = ko.observable(false);
        this.selectedProjectFilter = ko.observable(null);
        this.showWeekends.subscribe(val => {
            this.days().forEach(day => {
                if (day.isWeekend()) {
                    day.isVisible(val);
                }
            });
        });
        this.monthProgress = {
            scopes: ko.observableArray([]),
            total: ko.observable('0h'),
        };
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
    }

    
    login = async () => {
        this.logginIn(true);
        try {
            await this.slingr.login(this.email(), this.pass());
        } catch (e) {
            this.addToast('Invalid email or password', 'error');
        }
        if (this.slingr.token) {
            let user = await this.slingr.getCurrentUser();
            localStorage.setItem('solutions:timetracking:token', this.slingr.token);
            console.log('Logged', user);
            this.logged(true);
        }
        this.email(null);
        this.pass(null);
        this.logginIn(false);
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
            selectedTheme: 'light',
            onClickMonth: async (calendar, event) => {
                this.month(calendar.context.selectedMonth);
                await this.updateDashboard();
            },
            onClickYear: async (calendar, event) => {
                this.year(calendar.context.selectedYear);
                await this.updateDashboard();
            }
        }
        this.calendar = new VanillaCalendarPro.Calendar('#calendar', settings);
        this.calendar.init();
        await this.updateDashboard();
    }

    updateDashboard = async () => {
        this.loading(true);
        await this.updateHolidays();
        await this.updateTimeTracking();
        this.loading(false);
    }

    goToToday = async () => {
        let today = new Date();
        if (this.month() !== today.getMonth() || this.year() !== today.getFullYear()) {
            this.month(today.getMonth());
            this.year(today.getFullYear());
            this.calendar.set({ selectedMonth: this.month(), selectedYear: this.year() });
            await this.updateDashboard();
        }
        document.getElementById(getDateString(today)).scrollIntoView({ behavior: 'smooth' });
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
            global: { timeSpent: 0, colorClass: 'bg-primary', textColor: 'text-primary' },
            task: { timeSpent: 0, colorClass: 'bg-success', textColor: 'text-success' },
            supportTicket: { timeSpent: 0, colorClass: 'bg-info', textColor: 'text-info' },
        };

        let totalBillable = 0;
        for (const entry of entries) {
            const scope = entry.scope();
            if (scopeStats[scope]) {
                scopeStats[scope].timeSpent += entry.raw.timeSpent;
            }
            totalBillable += entry.raw.timeSpent;
        }

        const scopeProgress = [];
        for (const scope in scopeStats) {
            const stat = scopeStats[scope];
            const percentage = (stat.timeSpent / totalMonthMs) * 100;
            if (stat.timeSpent > 0) {
                scopeProgress.push({
                    scope: scope,
                    name: scope.charAt(0).toUpperCase() + scope.slice(1).replace('T', ' T'),
                    colorClass: stat.colorClass,
                    textColor: stat.textColor,
                    duration: formatMsToDuration(stat.timeSpent),
                    percentage: percentage.toFixed(2) + '%',
                });
            }
        }

        this.monthProgress.scopes(scopeProgress);
        this.monthProgress.total(formatMsToDuration(totalBillable));

        await this.updateProjectStats(totalMonthMs);
    }

    updateProjectStats = async (totalMonthMs) => {
        let { items: projects } = await model.slingr.get('/data/projects', {
            'members.user': model.slingr.user.id,
            _sortField: 'name',
            _sortType: 'asc',
            _size: 1000,
        });
        this.projects([]);
        for (let project of projects) {
            let projectEntries = this.weeks()
                .map(w => w.days()).flat()
                .map(d => d.entries()).flat()
                .filter(e => e.raw.project.id === project.id);

            const projectScopeStats = {
                global: { timeSpent: 0, colorClass: 'bg-primary' },
                task: { timeSpent: 0, colorClass: 'bg-success' },
                supportTicket: { timeSpent: 0, colorClass: 'bg-info' },
            };

            let totalProjectBillable = 0;
            for (const entry of projectEntries) {
                const scope = entry.scope();
                if (projectScopeStats[scope]) {
                    projectScopeStats[scope].timeSpent += entry.raw.timeSpent;
                }
                totalProjectBillable += entry.raw.timeSpent;
            }

            const projectScopeProgress = [];
            for (const scope in projectScopeStats) {
                const stat = projectScopeStats[scope];
                const percentage = (stat.timeSpent / totalMonthMs) * 100;
                if (stat.timeSpent > 0) {
                    projectScopeProgress.push({
                        scope: scope,
                        colorClass: stat.colorClass,
                        duration: formatMsToDuration(stat.timeSpent),
                        percentage: percentage.toFixed(2) + '%',
                    });
                }
            }

            this.projects.push({
                id: project.id,
                name: project.label,
                total: ko.observable(formatMsToDuration(totalProjectBillable)),
                scopes: ko.observableArray(projectScopeProgress),
            });
        }
    }

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
        let weeks = [{ week: 0, days: [] }];
        for (let day of days) {
            if (day.getDay() === 1 && weeks.length > 0) { // Is Monday
                weeks.push({ week: weeks.length, days: [] });
            }
            weeks[weeks.length - 1].days.push(day);
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
    let days = week.days.map(d => new Day(d, entries));
    return {
        week: ko.observable(week),
        days: ko.observableArray(days),
        isVisible: ko.observable(! days.every(d => d.isVisible())),
    }
}

function Day (date, entries) {
    const MAX_TIME_SPENT = 8 * 60 * 60 * 1000;
    let dateStr = getDateString(date);
    let holiday = model.holidays().find(h => h.day === dateStr);
    let isLeave = model.leaveDays().includes(dateStr);
    let isHoliday = Boolean(holiday);
    let isToday = date.toDateString() === new Date().toDateString();
    let isWeekend = [0, 6].includes(date.getDay());
    let isBussinessDay = ! isWeekend && ! holiday && !isLeave;
    let isVisible = (isBussinessDay || isHoliday || isLeave) || (isWeekend && model.showWeekends());

    let day = {
        title: date.toLocaleDateString(undefined, {
            weekday: 'short',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
        }),
        date: date,
        dateStr: ko.observable(dateStr),
        isToday: ko.observable(isToday),
        isHoliday: ko.observable(isHoliday),
        isLeave: ko.observable(isLeave),
        isWeekend: ko.observable(isWeekend),
        isBussinessDay: ko.observable(isBussinessDay),
        holidayDetail: ko.observable(holiday?.title),
        isVisible: ko.observable(isVisible),
        entries: ko.observableArray([]),
        durationMs: 0,
        durationBillable: 0,
        durationNonBillable: 0,
        visibleNotes: ko.observable(true),
        // Form
        scope: ko.observable('global'),
        notes: ko.observable(''),
        timeSpent: ko.observable(1 * 60 * 60 * 1000),
        time: ko.observable('1h'),
        project: ko.observable(null),
        task: ko.observable(null),
        ticket: ko.observable(null),
        tasks: ko.observableArray([]),
        tickets: ko.observableArray([]),
        toggleLeave: async (day) => {
            const dateStr = day.dateStr();
            if (model.leaveDays.indexOf(dateStr) > -1) {
                model.leaveDays.remove(dateStr);
            } else {
                model.leaveDays.push(dateStr);
            }
            await model.updateTimeTracking();
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
                if (day.scope() === 'task' && !day.task()) {
                    model.addToast('Please select a task.', 'error');
                    model.loading(false);
                    return;
                }
                if (day.scope() === 'supportTicket' && !day.ticket()) {
                    model.addToast('Please select a ticket.', 'error');
                    model.loading(false);
                    return;
                }

                await model.slingr.put(`/data/${TIME_TRACKING_ENTITY}/logTime`, {
                    project: day.project().id,
                    scope: day.scope(),
                    task: day.scope() === 'task' && day.task() ? day.task().id : null,
                    ticket: day.scope() === 'supportTicket' && day.ticket() ? day.ticket().id : null,
                    forMe: true,
                    date: day.dateStr(),
                    timeSpent: parseInt(day.timeSpent()),
                    notes: day.notes(),
                });
                // Reset form fields after successful log
                day.notes('');
                day.timeSpent(1 * 60 * 60 * 1000); // Reset to 1 hour
                day.scope('global'); // Reset scope to global
                day.task(null); // Clear task selection
                day.ticket(null); // Clear ticket selection
                // Project is not reset as it might be common for multiple entries

                model.newEntryModal.hide();
                await model.updateTimeTracking();
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

    day.isLoggable = ko.computed(function() {
        if (!day.project()) {
            return false;
        }
        if (day.scope() === 'task' && !day.task()) {
            return false;
        }
        if (day.scope() === 'supportTicket' && !day.ticket()) {
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
        day.task(null);
        day.ticket(null);
        await loadScopeOptions();
    });

    for (let entry of entries) {
        if (entry.date !== dateStr) continue;
        let entryDate = new Entry(entry, day);

        day.durationMs += entryDate.raw.timeSpent;
        day.durationBillable += entry.timeSpent;
        day.entries.push(entryDate);
    }
    day.duration = ko.observable(formatMsToDuration(day.durationMs));
    day.durationBillable = ko.observable(formatMsToDuration(day.durationBillable));
    day.durationNonBillable = ko.observable(formatMsToDuration(day.durationNonBillable));
    day.missingDuration = ko.observable(day.durationMs < MAX_TIME_SPENT ? formatMsToDuration(MAX_TIME_SPENT - day.durationMs) : null);
    day.isMissingTime = ko.observable(day.durationMs > 0 && day.durationMs < MAX_TIME_SPENT);

    day.canToggleLeave = ko.computed(function() {
        if (day.isWeekend() || day.isHoliday()) {
            return false;
        }
        if (day.isLeave()) {
            return true;
        }
        return day.entries().length === 0;
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
                await model.slingr.put(`/data/${TIME_TRACKING_ENTITY}/${this.id()}`, payload);
                await model.updateTimeTracking();
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
        edit_task: ko.observable(),
        edit_ticket: ko.observable(),
        edit_notes: ko.observable(),
        edit_timeSpent: ko.observable(),
        edit_time: ko.observable(''),
        edit_tasks: ko.observableArray([]),
        edit_tickets: ko.observableArray([]),

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
                    const taskObj = self.edit_tasks().find(t => t.id === self.raw.task.id);
                    self.edit_task(taskObj);
                }
                if (self.scope() === 'supportTicket' && self.raw.ticket) {
                    const ticketObj = self.edit_tickets().find(t => t.id === self.raw.ticket.id);
                    self.edit_ticket(ticketObj);
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
                    task: self.edit_scope() === 'task' && self.edit_task() ? self.edit_task().id : null,
                    ticket: self.edit_scope() === 'supportTicket' && self.edit_ticket() ? self.edit_ticket().id : null,
                    timeSpent: parseInt(self.edit_timeSpent()),
                    notes: self.edit_notes(),
                };
                await model.slingr.put(`/data/${TIME_TRACKING_ENTITY}/${self.id()}`, payload);
                model.addToast('Entry updated successfully.', 'success');
                model.editEntryModal.hide();
                await model.updateTimeTracking();
            } catch (e) {
                console.error(e);
                model.addToast('Error updating entry.', 'error');
            }
            model.loading(false);
        },
        remove: function() {
            model.openRemoveConfirmModal(self);
        },
        submitRemove: async function() {
            model.loading(true);
            try {
                await model.slingr.delete(`/data/${TIME_TRACKING_ENTITY}/${self.id()}`);
                model.addToast('Entry removed successfully.', 'success');
                model.removeConfirmModal.hide();
                await model.updateTimeTracking();
            } catch (e) {
                console.error(e);
                model.addToast('Error removing entry.', 'error');
            }
            model.loading(false);
        },
    };

    self.edit_timeSpent.subscribe(val => {
        self.edit_time(formatMsToDuration(val));
    });

    self.edit_project.subscribe(async () => {
        if (isInitializing) return;
        await self.loadEditScopeOptions();
    });
    self.edit_scope.subscribe(async () => {
        if (isInitializing) return;
        self.edit_task(null);
        self.edit_ticket(null);
        await self.loadEditScopeOptions();
    });

    self.isEditLoggable = ko.computed(function() {
        if (!self.edit_project()) return false;
        if (self.edit_scope() === 'task' && !self.edit_task()) {
            return false;
        }
        if (self.edit_scope() === 'supportTicket' && !self.edit_ticket()) {
            return false;
        }
        if (self.edit_notes() && self.edit_notes().trim() === '') {
            return false;
        }
        return true;
    });

    self.isVisible = ko.computed(function() {
        const selectedProjectId = model.selectedProjectFilter();
        if (!selectedProjectId) {
            return true;
        }
        return self.raw.project.id === selectedProjectId;
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
                colorClass = 'text-info';
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
document.addEventListener('DOMContentLoaded', () => {
    ko.applyBindings(model);
});