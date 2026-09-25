import "./styles.css";
import {
  statuses,
  priorities,
  getState,
  setFilter,
  addRepair,
  setStatus,
  addAdvance,
  removeAdvance,
  saveSettlement,
  clearSettlement,
  removeRepair,
  restoreRepair
} from "./records.js";
import { canSettle, computeSettlement } from "./settlement.js";

const app = document.querySelector("#app");
let showHistory = false;

function render() {
  const state = getState();
  const repairs = filteredRepairs(state);
  const unfinished = state.repairs.filter((repair) => repair.status !== "done").length;
  const advanceTotal = state.repairs.reduce((sum, repair) => sum + advanceSum(repair), 0);
  const tailTotal = state.repairs.reduce((sum, repair) => sum + (repair.settlement ? repair.settlement.tail : 0), 0);

  app.innerHTML = `
    <main class="shell">
      <header class="header">
        <div>
          <p class="eyebrow">本地家庭维护台</p>
          <h1>家庭维修垫付台</h1>
        </div>
        <section class="stats">
          <div class="stat"><span>未完工</span><strong>${unfinished}</strong></div>
          <div class="stat"><span>垫付总额</span><strong>¥${fmt(advanceTotal)}</strong></div>
          <div class="stat"><span>待补尾款</span><strong>¥${fmt(tailTotal)}</strong></div>
        </section>
      </header>

      <section class="layout">
        <aside class="panel">
          <h2>新增维修事项</h2>
          <form class="form" id="repair-form">
            <label>位置<input name="location" required placeholder="例如卫生间"></label>
            <label>问题描述<textarea name="title" required placeholder="例如门锁松动"></textarea></label>
            <label>优先级<select name="priority">${renderPriorityOptions("medium")}</select></label>
            <label>备注<textarea name="note" placeholder="师傅电话、材料或注意事项"></textarea></label>
            <button class="primary" type="submit">保存事项</button>
          </form>
        </aside>

        <section>
          <div class="toolbar">
            ${Object.entries(statuses)
              .map(([value, label]) => `<button class="seg ${state.filter === value ? "active" : ""}" data-filter="${value}">${label}</button>`)
              .join("")}
          </div>
          <div class="repairs">
            ${repairs.length ? repairs.map(renderRepair).join("") : `<div class="empty">当前状态下没有维修事项</div>`}
          </div>
          ${renderHistory(state)}
        </section>
      </section>
    </main>
  `;

  bindEvents();
}

function renderRepair(repair) {
  const settled = Boolean(repair.settlement);
  return `
    <article class="repair">
      <div class="content">
        <div class="row">
          <h3>${escapeHtml(repair.location)}</h3>
          <span class="priority ${repair.priority}">${priorities[repair.priority]}</span>
          <span class="status ${repair.status}">${statuses[repair.status]}</span>
          ${settled ? `<span class="status settled">已结清</span>` : ""}
        </div>
        <p>${escapeHtml(repair.title)}</p>
        ${repair.note ? `<p class="note">${escapeHtml(repair.note)}</p>` : ""}

        <section class="block">
          <div class="row section-head">
            <h4>垫付记录</h4>
            <span class="chip">合计 ¥${fmt(advanceSum(repair))}</span>
          </div>
          ${
            repair.advances.length
              ? `<table class="ledger">
                  <thead><tr><th>#</th><th>付款人</th><th>金额</th><th>用途</th><th></th></tr></thead>
                  <tbody>
                    ${repair.advances
                      .map(
                        (advance, index) => `
                          <tr>
                            <td>${index + 1}</td>
                            <td>${escapeHtml(advance.payer)}</td>
                            <td>¥${fmt(advance.amount)}</td>
                            <td>${escapeHtml(advance.purpose)}</td>
                            <td>${
                              settled
                                ? ""
                                : `<button class="link" data-repair="${repair.id}" data-advance="${advance.id}">删除</button>`
                            }</td>
                          </tr>`
                      )
                      .join("")}
                  </tbody>
                </table>`
              : `<div class="empty small">还没有垫付记录</div>`
          }
          ${
            settled
              ? ""
              : `<form class="advance-form" data-advance-form="${repair.id}">
                  <input name="payer" required placeholder="付款人">
                  <input name="amount" required type="number" min="0.01" step="0.01" placeholder="金额">
                  <input name="purpose" required placeholder="用途">
                  <button class="ghost" type="submit">登记垫付</button>
                </form>`
          }
        </section>

        <section class="block">
          ${settled ? renderSettlement(repair.settlement, repair.id) : renderSettleForm(repair)}
        </section>

        <div class="actions">
          <select data-status="${repair.id}" ${settled ? "disabled" : ""}>${renderStatusOptions(repair.status)}</select>
          <button class="ghost danger" data-delete="${repair.id}">移除</button>
        </div>
      </div>
    </article>
  `;
}

function renderSettleForm(repair) {
  const ready = canSettle(repair);
  return `
    <div class="row section-head"><h4>完工结算</h4></div>
    <form class="settle-form" data-settle-form="${repair.id}">
      <input name="total" type="number" min="0" step="0.01" required placeholder="实付总额" ${ready ? "" : "disabled"}>
      <button class="primary" type="submit" ${ready ? "" : "disabled"}>按登记顺序核销</button>
    </form>
    ${ready ? "" : `<p class="hint">事项完工（已完成）后才能结清</p>`}
  `;
}

function renderSettlement(settlement, repairId) {
  return `
    <div class="row section-head">
      <h4>结算单</h4>
      <span class="chip">实付 ¥${fmt(settlement.total)}</span>
      <span class="chip">垫付 ¥${fmt(settlement.advanceTotal)}</span>
      ${settlement.tail > 0 ? `<span class="chip warn">尾款 ¥${fmt(settlement.tail)}</span>` : ""}
      ${settlement.refundTotal > 0 ? `<span class="chip back">退款 ¥${fmt(settlement.refundTotal)}</span>` : ""}
    </div>
    <table class="ledger">
      <thead><tr><th>#</th><th>付款人</th><th>垫付</th><th>核销</th><th>退回</th></tr></thead>
      <tbody>
        ${settlement.lines
          .map(
            (line) => `
              <tr>
                <td>${line.order}</td>
                <td>${escapeHtml(line.payer)}</td>
                <td>¥${fmt(line.amount)}</td>
                <td>¥${fmt(line.applied)}</td>
                <td>${line.refund > 0 ? `¥${fmt(line.refund)}` : "—"}</td>
              </tr>`
          )
          .join("")}
      </tbody>
    </table>
    ${settlement.tail > 0 ? `<p class="hint">垫付不足，还差尾款 ¥${fmt(settlement.tail)} 待补。</p>` : ""}
    ${settlement.refundTotal > 0 ? `<p class="hint">垫付超出，从最后一笔往前共退 ¥${fmt(settlement.refundTotal)}。</p>` : ""}
    <div class="row spread">
      <span class="hint">结清于 ${formatTime(settlement.settledAt)}</span>
      <button class="link" data-unsettle="${repairId}">撤销结算</button>
    </div>
  `;
}

function renderHistory(state) {
  if (!state.history.length) return "";
  return `
    <section class="history">
      <button class="seg" data-toggle-history>历史账（${state.history.length}）${showHistory ? "收起" : "展开"}</button>
      ${showHistory ? state.history.map(renderHistoryItem).join("") : ""}
    </section>
  `;
}

function renderHistoryItem(item) {
  const settlement = item.settlement;
  return `
    <article class="repair archived">
      <div class="content">
        <div class="row">
          <h3>${escapeHtml(item.location)}</h3>
          <span class="status ${item.status}">${statuses[item.status]}</span>
          ${settlement ? `<span class="status settled">已结清</span>` : ""}
          <span class="chip">移除于 ${formatTime(item.removedAt)}</span>
        </div>
        <p>${escapeHtml(item.title)}</p>
        <div class="row">
          <span class="chip">垫付 ${item.advances.length} 笔 · ¥${fmt(advanceSum(item))}</span>
          ${settlement ? `<span class="chip">实付 ¥${fmt(settlement.total)}</span>` : ""}
          ${settlement && settlement.tail > 0 ? `<span class="chip warn">尾款 ¥${fmt(settlement.tail)}</span>` : ""}
          ${settlement && settlement.refundTotal > 0 ? `<span class="chip back">退款 ¥${fmt(settlement.refundTotal)}</span>` : ""}
        </div>
        ${
          item.advances.length
            ? `<table class="ledger">
                <thead><tr><th>#</th><th>付款人</th><th>金额</th><th>用途</th></tr></thead>
                <tbody>
                  ${item.advances
                    .map(
                      (advance, index) => `
                        <tr>
                          <td>${index + 1}</td>
                          <td>${escapeHtml(advance.payer)}</td>
                          <td>¥${fmt(advance.amount)}</td>
                          <td>${escapeHtml(advance.purpose)}</td>
                        </tr>`
                    )
                    .join("")}
                </tbody>
              </table>`
            : ""
        }
        <div class="actions">
          <button class="ghost" data-restore="${item.id}">恢复到事项列表</button>
        </div>
      </div>
    </article>
  `;
}

function renderStatusOptions(selected) {
  return Object.entries(statuses)
    .filter(([value]) => value !== "all")
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function renderPriorityOptions(selected) {
  return Object.entries(priorities)
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function bindEvents() {
  document.querySelector("#repair-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    addRepair({
      location: data.location.trim(),
      title: data.title.trim(),
      priority: data.priority,
      note: data.note.trim()
    });
    render();
  });

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      setFilter(button.dataset.filter);
      render();
    });
  });

  document.querySelectorAll("[data-status]").forEach((select) => {
    select.addEventListener("change", () => {
      setStatus(select.dataset.status, select.value);
      render();
    });
  });

  document.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      removeRepair(button.dataset.delete);
      render();
    });
  });

  document.querySelectorAll("[data-advance-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      const amount = Number(data.amount);
      if (!Number.isFinite(amount) || amount <= 0) return;
      addAdvance(form.dataset.advanceForm, {
        payer: data.payer.trim(),
        amount,
        purpose: data.purpose.trim()
      });
      render();
    });
  });

  document.querySelectorAll("[data-advance]").forEach((button) => {
    button.addEventListener("click", () => {
      removeAdvance(button.dataset.repair, button.dataset.advance);
      render();
    });
  });

  document.querySelectorAll("[data-settle-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const repair = getState().repairs.find((item) => item.id === form.dataset.settleForm);
      if (!repair || !canSettle(repair)) return;
      const total = Number(new FormData(form).get("total"));
      if (!Number.isFinite(total) || total < 0) return;
      saveSettlement(repair.id, computeSettlement(repair.advances, total));
      render();
    });
  });

  document.querySelectorAll("[data-unsettle]").forEach((button) => {
    button.addEventListener("click", () => {
      clearSettlement(button.dataset.unsettle);
      render();
    });
  });

  document.querySelectorAll("[data-toggle-history]").forEach((button) => {
    button.addEventListener("click", () => {
      showHistory = !showHistory;
      render();
    });
  });

  document.querySelectorAll("[data-restore]").forEach((button) => {
    button.addEventListener("click", () => {
      restoreRepair(button.dataset.restore);
      render();
    });
  });
}

function filteredRepairs(state) {
  if (state.filter === "all") return state.repairs;
  return state.repairs.filter((repair) => repair.status === state.filter);
}

function advanceSum(repair) {
  return repair.advances.reduce((sum, advance) => sum + Number(advance.amount || 0), 0);
}

function fmt(value) {
  const num = Number(value || 0);
  return Number.isInteger(num) ? String(num) : num.toFixed(2);
}

function formatTime(iso) {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

render();
