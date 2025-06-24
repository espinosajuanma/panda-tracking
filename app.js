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
        this.slingr = new Slingr('hq', 'prod');

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

        let token = localStorage.getItem('hq:timetracking:token');
        if (token) {
            console.log('Using token', token);
            this.slingr.token = token;
            this.logginIn(true);
            this.slingr.getCurrentUser()
            .then(user => {
                console.log('Logged in as', user?.id);
                this.logged(true);
                localStorage.setItem('hq:timetracking:token', this.slingr.token);
                this.addToast('Logged in');
            })
            .catch(e => {
                console.warn('Invalid token', e);
                this.slingr.token = null;
                localStorage.removeItem('hq:timetracking:token');
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
            nonBillablePercentage: ko.observable(0),
            billable: ko.observable('0h'),
            nonBillable: ko.observable('0h'),
        }
        this.billable = ko.observable(true);
        this.nonBillable = ko.observable(false);
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
            localStorage.setItem('hq:timetracking:token', this.slingr.token);
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
        let { items: holidays } = await this.slingr.get('/data/management.holidays', query);
        //this.calendar.set({ selectedHolidays: holidays.map(h => h.day) });
        this.holidays(holidays)
    }

    updateTimeTracking = async () => {
        let [start, end] = [this.getStartMonth(), this.getEndMonth()];
        let query = {
            _size: 1000,
            _sortField: 'day',
            _sortType: 'asc',
            day: `between(${start.getTime()},${end.getTime()})`,
            person: this.slingr.user.id,
        }
        let { items: entries } = await this.slingr.get('/data/frontendBilling.timeTracking', query);

        let weeks = this.listWeeksBetweenMonth()
            .map(week => new Week(week, entries));
        this.weeks(weeks);

        await this.updateStats();
    }

    updateStats = async () => {
        let total = this.weeks().map(w => w.days()).flat().filter(e => ! e.isWeekend()).length * 8 * 60 * 60 * 1000;
        let entries = this.weeks().map(w => w.days()).flat().map(d => d.entries()).flat();
        let totalBillable = entries.filter(e => e.raw.billable).reduce((acc, e) => acc + e.raw.timeSpent, 0);
        let totalNonBillable = entries.filter(e => !e.raw.billable).reduce((acc, e) => acc + e.raw.timeSpent, 0);

        let billablePercentage = ((totalBillable / total) * 100).toFixed(2) + '%';
        let nonBillablePercentage = ((totalNonBillable / total) * 100).toFixed(2) + '%';

        this.monthProgress.billable(formatMsToHours(totalBillable));
        this.monthProgress.nonBillable(formatMsToHours(totalNonBillable));
        this.monthProgress.billablePercentage(billablePercentage);
        this.monthProgress.nonBillablePercentage(nonBillablePercentage);

        let { items: projects } = await model.slingr.get('/data/frontend.projects', {
            'people.user': model.slingr.user.id,
        });

        this.projects([]);
        for (let project of projects) {
            let entries = this.weeks()
                .map(w => w.days()).flat()
                .map(d => d.entries()).flat()
                .filter(e => e.raw.project.id === project.id);
            let total = entries.reduce((acc, e) => acc + e.raw.timeSpent, 0);
            let billable = entries.filter(e => e.raw.billable).reduce((acc, e) => acc + e.raw.timeSpent, 0);
            let nonBillable = entries.filter(e => !e.raw.billable).reduce((acc, e) => acc + e.raw.timeSpent, 0);

            let billablePercentage = ((billable / total) * 100).toFixed(2) + '%';
            let nonBillablePercentage = ((nonBillable / total) * 100).toFixed(2) + '%';

            this.projects.push({
                id: ko.observable(project.id),
                name: ko.observable(project.label),
                isVisible: ko.observable(Boolean(total)),
                total: ko.observable(formatMsToHours(total)),
                billable: ko.observable(formatMsToHours(billable)),
                nonBillable: ko.observable(formatMsToHours(nonBillable)),
                billablePercentage: ko.observable(billablePercentage),
                nonBillablePercentage: ko.observable(nonBillablePercentage),
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
const model = new ViewModel();

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
        visibleNotes: ko.observable(false),
        // Form
        billable: ko.observable(true),
        notes: ko.observable(''),
        timeSpent: ko.observable(4 * 60 * 60 * 1000),
        time: ko.observable('4h'),
        project: ko.observable(null),
        logEntry: async (day) => {
            model.loading(true);
            try {
                let res = await model.slingr.post('/data/frontendBilling.timeTracking', {
                    project: day.project().id(),
                    timeSpent: parseInt(day.timeSpent()),
                    notes: day.notes(),
                    billable: day.billable(),
                    day: day.dateStr(),
                });
                await model.updateTimeTracking();
            } catch(e) {
                console.error(e);
            }
            model.loading(false);
        },
        showNotes: (day, a) => {
            day.visibleNotes(! day.visibleNotes());
        }
    }
    day.billableText = ko.computed(() => day.billable() ? 'Billable' : 'Non-billable');
    day.timeSpent.subscribe(val => {
        day.time(formatMsToHours(val));
    });
    for (let entry of entries) {
        if (entry.day !== dateStr) continue;
        let entryDate = new Entry(entry, day);

        day.durationMs += entryDate.raw.timeSpent;
        if (entry.billable) {
            day.durationBillable += entry.timeSpent;
        } else {
            day.durationNonBillable += entry.timeSpent;
        }
        day.entries.push(entryDate);
    }
    day.duration = ko.observable(formatMsToHours(day.durationMs));
    day.durationBillable = ko.observable(formatMsToHours(day.durationBillable));
    day.durationNonBillable = ko.observable(formatMsToHours(day.durationNonBillable));
    day.missingDuration = ko.observable(day.durationMs < MAX_TIME_SPENT ? formatMsToHours(MAX_TIME_SPENT - day.durationMs) : null);

    return day;
}

function Entry (entry, day) {
    let readOnly = entry.createDay !== getDateString(new Date());
    let duration = formatMsToHours(entry.timeSpent);
    let shortName = entry.project.label.substring(0, 11);
    if (entry.project.label.length > 11) {
        shortName += '...';
    }
    return {
        id: ko.observable(entry.id),
        readOnly: ko.observable(readOnly),
        project: ko.observable(shortName),
        timeSpent: ko.observable(entry.timeSpent),
        createDay: ko.observable(entry.createDay),
        duration: ko.observable(duration),
        notes: ko.observable(entry.notes),
        billable: ko.observable(entry.billable),
        nonBillable: ko.observable(!entry.billable),
        day: day,
        edit: (entry) => {
            day.billable(entry.billable());
            day.notes(entry.notes());
            day.timeSpent(entry.timeSpent());
            day.project(entry.project());
        },
        remove: async (entry) => {
            model.loading(true);
            try {
                let res = await model.slingr.delete(`/data/frontendBilling.timeTracking/${entry.id()}`);
                console.log(res);
                await model.updateTimeTracking();
            } catch (e) {
                console.error(e);
            }
            model.loading(false);
        },
        raw: entry,
    }
}

function getDateString(date) {
    return date.toISOString().split('T')[0];
}
function formatMsToHours(ms) {
    let n = (ms / 1000 / 60 / 60);
    n = n % 1 === 0 ? n.toString() : n.toFixed(1);
    return n + 'h';
}
function getMsFromHours(hours) {
    return hours * 1000 * 60 * 60;
}

document.addEventListener('DOMContentLoaded', () => {
    ko.applyBindings(model);
});