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
                this.addToast('Logged in');
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
        this.toasts.subscribe(arr => {
            setTimeout(() => {
                let t = arr.pop();
                let toast = $('#'+t.id);
                toast.show();
                setTimeout(() => toast.remove(), 10000);
            }, 50);
        });

        // Calendar
        this.holidays = ko.observableArray([]);
        this.month = ko.observable(new Date().getMonth());
        this.year = ko.observable(new Date().getFullYear());

        // Time Tracking
        this.weeks = ko.observableArray([]);
        this.days = ko.observableArray([]);
        this.projects = ko.observableArray([]);
        this.showWeekends = ko.observable(false);
        this.showWeekends.subscribe(val => {
            this.days().forEach(day => {
                if (day.isWeekend()) {
                    day.isVisible(val);
                }
            });
        });
        this.monthProgress = {
            billablePercentage: ko.observable(0),
            billable: ko.observable('0h'),
        }
        this.billable = ko.observable(true);
        this.notes = ko.observable('');
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

    addToast = (msg, type = 'info') => {
        let id = new Date().getTime();
        this.toasts.push({
            id: id,
            msg: msg,
            error: type === 'error',
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
        let total = this.weeks().map(w => w.days()).flat().filter(e => ! e.isWeekend()).length * 8 * 60 * 60 * 1000;
        let entries = this.weeks().map(w => w.days()).flat().map(d => d.entries()).flat();
        let totalBillable = entries.reduce((acc, e) => acc + e.raw.timeSpent, 0);
        let billablePercentage = ((totalBillable / total) * 100).toFixed(2) + '%';
        this.monthProgress.billable(formatMsToDuration(totalBillable));
        this.monthProgress.billablePercentage(billablePercentage);

        let { items: projects } = await model.slingr.get('/data/projects', {
            'members.user': model.slingr.user.id,
            _sortField: 'name',
            _sortType: 'asc',
            _size: 1000,
        });

        this.projects([]);
        for (let project of projects) {
            let entries = this.weeks()
                .map(w => w.days()).flat()
                .map(d => d.entries()).flat()
                .filter(e => e.raw.project.id === project.id);
            let billable = entries.reduce((acc, e) => acc + e.raw.timeSpent, 0);
            let billablePercentage = ((billable / total) * 100).toFixed(2) + '%';

            this.projects.push({
                id: ko.observable(project.id),
                name: ko.observable(project.label),
                isVisible: ko.observable(Boolean(total)),
                total: ko.observable(formatMsToDuration(total)),
                billable: ko.observable(formatMsToDuration(billable)),
                billablePercentage: ko.observable(billablePercentage),
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
    let isHoliday = Boolean(holiday);
    let isToday = date.toDateString() === new Date().toDateString();
    let isWeekend = [0, 6].includes(date.getDay());
    let isBussinessDay = ! isWeekend && ! holiday;
    let isVisible = (isBussinessDay || isHoliday) ?? (isWeekend && model.showWeekends());

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
                if (day.scope() === 'ticket' && !day.ticket()) {
                    model.addToast('Please select a ticket.', 'error');
                    model.loading(false);
                    return;
                }

                await model.slingr.put(`/data/${TIME_TRACKING_ENTITY}/logTime`, {
                    project: day.project().id(),
                    scope: day.scope(),
                    task: day.scope() === 'task' && day.task() ? day.task().id : null,
                    ticket: day.scope() === 'ticket' && day.ticket() ? day.ticket().id : null,
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
        if (day.scope() === 'ticket' && !day.ticket()) {
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
            const defaultProject = model.projects().find(p => p.name() === 'Collaborative Work Solutions');
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
            let obs = null;
            if (scope === 'task') {
                obs = day.tasks;
                entity = 'dev.tasks';
            }
            if (scope === 'ticket') {
                obs = day.tickets;
                entity = 'support.tickets';
            }
            const { items } = await model.slingr.get(`/data/${entity}`, {
                project: project.id(),
                _size: 1000,
                _sortField: 'n,umber',
                _sortType: 'desc',
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

    return day;
}

function Entry (entry, day) {
    let readOnly = false; // entry.createDay !== getDateString(new Date());
    let duration = formatMsToDuration(entry.timeSpent);
    let shortName = entry.project.label.substring(0, 11);
    if (entry.project.label.length > 11) {
        shortName += '...';
    }
    return {
        id: ko.observable(entry.id),
        readOnly: ko.observable(readOnly),
        project: ko.observable(entry.project.label),
        scope: ko.observable(entry.task ? 'task' : entry.ticket ? 'ticket' : 'global'),
        task: ko.observable(entry.task?.label ?? entry.ticket?.label ?? 'Global to the project'),
        timeSpent: ko.observable(entry.timeSpent),
        createDay: ko.observable(entry.createDay),
        duration: ko.observable(duration),
        notes: ko.observable(entry.notes),
        editMode: ko.observable(false),
        removeMode: ko.observable(false),
        day: day,
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
        edit: (entry) => {
            console.log(entry);
            entry.editMode(true);
        },
        submitEdit: async (entry) => {
            model.loading(true);
            try {
                entry.raw = {
                    ...entry.raw,
                    timeSpent: parseInt(entry.timeSpent()),
                    notes: entry.notes(),
                    project: { id: entry.project().id() },
                    task: entry.scope() === 'task' ? null : { id: entry.task().id() },
                    ticket: entry.scope() === 'ticket' ? null : { id: entry.ticket().id() },
                }
                let res = await model.slingr.put(`/data/${TIME_TRACKING_ENTITY}/${entry.id()}`, entry.raw);
                console.log(res);
                await model.updateTimeTracking();
            } catch (e) {
                console.error(e);
            }
            model.loading(false);
            entry.editMode(false);
        },
        cancelEdit: async (entry) => {
            entry.editMode(false);
            model.loading(true);
            await model.updateTimeTracking();
            model.loading(false);
        },
        remove: (entry) => {
            entry.removeMode(true);
        },
        submitRemove: async (entry) => {
            model.loading(true);
            try {
                let res = await model.slingr.delete(`/data/${TIME_TRACKING_ENTITY}/${entry.id()}`);
                console.log(res);
                await model.updateTimeTracking();
            } catch (e) {
                console.error(e);
            }
            model.loading(false);
        },
        cancelRemove: (entry) => {
            entry.removeMode(false);
        },
    }
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