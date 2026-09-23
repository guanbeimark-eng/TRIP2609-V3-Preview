/* ===== Budget Module ===== */
const Budget = (() => {
    let currentTrip = null;
    let editingExpenseIdx = null;

    const categoryColors = {
        transport: 'var(--bcat-transport)',
        accommodation: 'var(--bcat-accommodation)',
        food: 'var(--bcat-food)',
        activities: 'var(--bcat-activities)',
        shopping: 'var(--bcat-shopping)',
        other: 'var(--bcat-other)',
    };

    const categoryLabels = {
        transport: 'Transport',
        accommodation: 'Accommodation',
        food: 'Food & Drink',
        activities: 'Activities',
        shopping: 'Shopping',
        other: 'Other',
    };

    function init(trip) {
        currentTrip = trip;
        bindEvents();
        render();
    }

    function bindEvents() {
        document.getElementById('btnAddExpense').addEventListener('click', () => openExpenseModal(null));
        document.getElementById('btnSaveExpense').addEventListener('click', saveExpense);
        document.getElementById('budgetTotal').addEventListener('input', (e) => {
            currentTrip.budgetTotal = parseFloat(e.target.value) || 0;
            Storage.saveTrip(currentTrip);
            renderOverview();
        });
        document.getElementById('budgetCurrency').addEventListener('change', (e) => {
            currentTrip.budgetCurrency = e.target.value;
            Storage.saveTrip(currentTrip);
            render();
            App.updateStats();
        });
    }

    function openExpenseModal(idx) {
        editingExpenseIdx = idx;
        const modal = document.getElementById('expenseModal');

        if (idx !== null && idx !== undefined) {
            const exp = currentTrip.expenses[idx];
            document.getElementById('expenseDescription').value = exp.description || '';
            document.getElementById('expenseAmount').value = exp.amount || '';
            document.getElementById('expenseCurrency').value = exp.currency || currentTrip.budgetCurrency;
            document.getElementById('expenseCategory').value = exp.category || 'other';
            document.getElementById('expenseDate').value = exp.date || '';
            document.getElementById('expenseNotes').value = exp.notes || '';
        } else {
            document.getElementById('expenseDescription').value = '';
            document.getElementById('expenseAmount').value = '';
            document.getElementById('expenseCurrency').value = currentTrip.budgetCurrency;
            document.getElementById('expenseCategory').value = 'food';
            document.getElementById('expenseDate').value = new Date().toISOString().split('T')[0];
            document.getElementById('expenseNotes').value = '';
        }
        modal.classList.add('open');
    }

    function saveExpense() {
        const description = document.getElementById('expenseDescription').value.trim();
        const amount = parseFloat(document.getElementById('expenseAmount').value);
        if (!description || !amount) {
            document.getElementById('expenseDescription').focus();
            return;
        }

        const expense = {
            id: editingExpenseIdx !== null ? currentTrip.expenses[editingExpenseIdx].id : Storage.generateId(),
            description,
            amount,
            currency: document.getElementById('expenseCurrency').value,
            category: document.getElementById('expenseCategory').value,
            date: document.getElementById('expenseDate').value,
            notes: document.getElementById('expenseNotes').value,
        };

        if (editingExpenseIdx !== null) {
            currentTrip.expenses[editingExpenseIdx] = expense;
        } else {
            currentTrip.expenses.push(expense);
        }

        Storage.saveTrip(currentTrip);
        document.getElementById('expenseModal').classList.remove('open');
        editingExpenseIdx = null;
        render();
        App.updateStats();
    }

    function deleteExpense(idx) {
        if (!confirm('Delete this expense?')) return;
        currentTrip.expenses.splice(idx, 1);
        Storage.saveTrip(currentTrip);
        render();
        App.updateStats();
    }

    function getTotalSpent() {
        return getExpenseTotal() + getReservationTotal() + getActivityTotal();
    }

    function getExpenseTotal() {
        return currentTrip.expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    }

    function getReservationTotal() {
        return (currentTrip.reservations || []).reduce((sum, r) => sum + (r.cost || 0), 0);
    }

    function getActivityTotal() {
        return (currentTrip.days || []).reduce((daySum, day) =>
            daySum + day.activities.reduce((actSum, act) =>
                actSum + (act.excludeFromBudget ? 0 : (act.cost || 0)), 0), 0);
    }

    function getCategoryTotals() {
        const totals = {};

        // Manual expenses
        currentTrip.expenses.forEach(e => {
            const cat = e.category || 'other';
            totals[cat] = (totals[cat] || 0) + (e.amount || 0);
        });

        // Reservation costs — map to budget categories
        const resCatMap = { flight: 'transport', train: 'transport', bus: 'transport', rental: 'transport', hotel: 'accommodation', other: 'other' };
        (currentTrip.reservations || []).forEach(r => {
            if (r.cost) {
                const cat = resCatMap[r.type] || 'other';
                totals[cat] = (totals[cat] || 0) + r.cost;
            }
        });

        // Activity costs — map to budget categories (skip excluded)
        const actCatMap = { food: 'food', sightseeing: 'activities', activity: 'activities', transport: 'transport', lodging: 'accommodation', shopping: 'shopping', other: 'other' };
        (currentTrip.days || []).forEach(day => {
            day.activities.forEach(act => {
                if (act.cost && !act.excludeFromBudget) {
                    const cat = actCatMap[act.category] || 'other';
                    totals[cat] = (totals[cat] || 0) + act.cost;
                }
            });
        });

        return totals;
    }

    function getCurrencySymbol(code) {
        const symbols = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', SEK: 'kr ', NOK: 'kr ', DKK: 'kr ', CHF: 'Fr ', CAD: '$', AUD: '$', THB: '฿' };
        return symbols[code] || code + ' ';
    }

    function renderOverview() {
        const total = currentTrip.budgetTotal || 0;
        const spent = getTotalSpent();
        const remaining = total - spent;
        const sym = getCurrencySymbol(currentTrip.budgetCurrency);

        const remainEl = document.getElementById('budgetRemaining');
        remainEl.textContent = `${sym}${remaining.toFixed(remaining % 1 === 0 ? 0 : 2)}`;
        remainEl.classList.toggle('over-budget', remaining < 0);

        const bar = document.getElementById('budgetBar');
        const pct = total > 0 ? Math.min((spent / total) * 100, 100) : 0;
        bar.style.width = pct + '%';
        bar.classList.toggle('over-budget', spent > total && total > 0);

        // Render cost breakdown by source
        const expTotal = getExpenseTotal();
        const resTotal = getReservationTotal();
        const actTotal = getActivityTotal();
        const breakdownEl = document.getElementById('budgetBreakdown');
        if (breakdownEl) {
            const fmt = (v) => `${sym}${v.toFixed(v % 1 === 0 ? 0 : 2)}`;
            breakdownEl.innerHTML = `
                <div class="budget-breakdown-item"><span>Manual expenses</span><span>${fmt(expTotal)}</span></div>
                ${resTotal > 0 ? `<div class="budget-breakdown-item"><span>Reservations</span><span>${fmt(resTotal)}</span></div>` : ''}
                ${actTotal > 0 ? `<div class="budget-breakdown-item"><span>Activity costs</span><span>${fmt(actTotal)}</span></div>` : ''}
                <div class="budget-breakdown-item total"><span>Total spent</span><span>${fmt(spent)}</span></div>
            `;
        }
    }

    function renderChart() {
        const container = document.getElementById('budgetChart');
        const totals = getCategoryTotals();
        const maxAmount = Math.max(...Object.values(totals), 1);
        const sym = getCurrencySymbol(currentTrip.budgetCurrency);

        container.innerHTML = Object.keys(categoryLabels).map(cat => {
            const amount = totals[cat] || 0;
            const pct = (amount / maxAmount) * 100;
            return `
                <div class="budget-chart-item">
                    <div class="budget-chart-item-header">
                        <span class="budget-chart-item-label">${categoryLabels[cat]}</span>
                        <span class="budget-chart-item-amount">${sym}${amount.toFixed(amount % 1 === 0 ? 0 : 2)}</span>
                    </div>
                    <div class="budget-chart-bar">
                        <div class="budget-chart-bar-fill" style="width: ${pct}%; background: ${categoryColors[cat]}"></div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderExpenses() {
        const container = document.getElementById('expensesList');
        if (currentTrip.expenses.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-receipt"></i>
                    <p>No expenses tracked yet.</p>
                    <button class="btn btn-small" onclick="Budget.openExpenseModal()"><i class="fa-solid fa-plus"></i> Add Expense</button>
                </div>
            `;
            return;
        }

        // Sort by date descending
        const sorted = currentTrip.expenses
            .map((e, idx) => ({ ...e, _idx: idx }))
            .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

        const sym = getCurrencySymbol(currentTrip.budgetCurrency);
        container.innerHTML = sorted.map(exp => {
            const expSym = getCurrencySymbol(exp.currency || currentTrip.budgetCurrency);
            return `
                <div class="expense-item">
                    <div class="expense-cat-dot ${exp.category}"></div>
                    <div class="expense-info">
                        <h4>${escapeHtml(exp.description)}</h4>
                        <div class="expense-info-meta">
                            ${exp.date || ''} ${exp.notes ? '· ' + escapeHtml(exp.notes) : ''}
                        </div>
                    </div>
                    <div class="expense-amount">${expSym}${exp.amount.toFixed(exp.amount % 1 === 0 ? 0 : 2)}</div>
                    <div class="expense-actions">
                        <button onclick="Budget.openExpenseModal(${exp._idx})" title="Edit"><i class="fa-solid fa-pen"></i></button>
                        <button onclick="Budget.deleteExpense(${exp._idx})" title="Delete"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
            `;
        }).join('');
    }

    function render() {
        document.getElementById('budgetTotal').value = currentTrip.budgetTotal || '';
        document.getElementById('budgetCurrency').value = currentTrip.budgetCurrency || 'USD';
        renderOverview();
        renderChart();
        renderExpenses();
    }

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML.replace(/'/g, '&#39;');
    }

    function update(trip) {
        currentTrip = trip;
        render();
    }

    return {
        init,
        update,
        render,
        openExpenseModal,
        saveExpense,
        deleteExpense,
        getTotalSpent,
        getExpenseTotal,
        getReservationTotal,
        getActivityTotal,
        getCurrencySymbol,
    };
})();
