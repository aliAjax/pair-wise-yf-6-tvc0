// 页面层：只负责渲染和把用户操作转交给记录层 / 结算层。
import "./styles.css";
import { store } from "./records.js";
import { canSettle, refundQueue } from "./settlement.js";

const statuses = {
  all: "全部",
  todo: "待处理",
  doing: "处理中",
  done: "已完成"
};

const priorities = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级"
};

const app = document.querySelector("#app");
let notice = null; // { kind: "ok" | "error", text }

export function initPage() {
  bindEvents();
  render();
}

// ---------- 工具 ----------

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function formatMoney(value) {
  const amount = Number(value || 0);
  return `¥${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function advancesTotal(repair) {
  return repair.advances.reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function tryAction(action, okText) {
  try {
    action();
    notice = okText ? { kind: "ok", text: okText } : null;
  } catch (error) {
    notice = { kind: "error", text: error.message };
  }
  render();
}

// ---------- 渲染 ----------

function render() {
  const { repairs, history, filter } = store.state;
  const unfinished = repairs.filter((repair) => repair.status !== "done");
  const advanceTotal = repairs.reduce((sum, repair) => sum + advancesTotal(repair), 0);
  const balanceTotal = repairs.reduce((sum, repair) => sum + (repair.settlement ? Number(repair.settlement.balanceDue || 0) : 0), 0);

  app.innerHTML = `
    <main class="shell">
      <header class="header">
        <div>
          <p class="eyebrow">本地家庭维护台</p>
          <h1>费用垫付台</h1>
        </div>
        <section class="stats">
          <div class="stat"><span>未完成</span><strong>${unfinished.length}</strong></div>
          <div class="stat"><span>已垫付合计</span><strong>${formatMoney(advanceTotal)}</strong></div>
          <div class="stat"><span>待收尾款</span><strong>${formatMoney(balanceTotal)}</strong></div>
        </section>
      </header>

      ${notice ? `<div class="notice ${notice.kind}">${escapeHtml(notice.text)}</div>` : ""}

      <section class="layout">
        <aside class="panel">
          <h2>新增维修事项</h2>
          <form class="form" id="repair-form">
            <label>位置<input name="location" required placeholder="例如卫生间"></label>
            <label>问题描述<textarea name="title" required placeholder="例如门锁松动"></textarea></label>
            <label>优先级<select name="priority">${renderPriorityOptions("medium")}</select></label>
            <label>预计费用<input name="cost" type="number" min="0" step="0.01" value="0"></label>
            <label>处理状态<select name="status">${renderStatusOptions("todo")}</select></label>
            <label>照片链接<input name="photo" type="url" placeholder="可选，粘贴图片地址"></label>
            <label>备注<textarea name="note" placeholder="师傅电话、材料或注意事项"></textarea></label>
            <button class="primary" type="submit">保存事项</button>
          </form>
        </aside>

        <section>
          <div class="toolbar">
            ${Object.entries(statuses).map(([value, label]) => `<button type="button" class="seg ${filter === value ? "active" : ""}" data-filter="${value}">${label}</button>`).join("")}
            <span class="toolbar-spacer"></span>
            <button type="button" class="seg ${filter === "history" ? "active" : ""}" data-filter="history">历史账 (${history.length})</button>
          </div>
          <div class="repairs">
            ${filter === "history" ? renderHistory(history) : renderActiveList(repairs, filter)}
          </div>
        </section>
      </section>
    </main>
  `;
}

function renderActiveList(repairs, filter) {
  const visible = filter === "all" ? repairs : repairs.filter((repair) => repair.status === filter);
  if (!visible.length) return `<div class="empty">当前状态下没有维修事项，被移除的事项可在历史账查看</div>`;
  return visible.map((repair) => renderRepairCard(repair, false)).join("");
}

function renderHistory(history) {
  if (!history.length) return `<div class="empty">历史账为空：移除的维修事项连同垫付与结算记录会保存在这里，重开页面也能查看</div>`;
  return history.map((repair) => renderRepairCard(repair, true)).join("");
}

function renderRepairCard(repair, archived) {
  return `
    <article class="repair-card ${archived ? "archived" : ""}">
      ${archived ? `<div class="archive-banner">历史账 · 移除于 ${formatTime(repair.archivedAt)}${repair.settlement ? " · 已结清" : " · 未结清"}</div>` : ""}
      <header class="repair-head">
        <div class="repair-main">
          <h3>${escapeHtml(repair.location)}<span class="repair-title">${escapeHtml(repair.title)}</span></h3>
          <div class="row">
            <span class="priority ${repair.priority}">${priorities[repair.priority]}</span>
            <span class="status ${repair.status}">${statuses[repair.status]}</span>
            <span class="chip">预计 ${formatMoney(repair.cost)}</span>
            ${repair.note ? `<span class="chip">${escapeHtml(repair.note)}</span>` : ""}
            <span class="muted">登记于 ${formatTime(repair.createdAt)}</span>
          </div>
        </div>
        ${repair.photo ? `<a class="thumb-link" href="${escapeHtml(repair.photo)}" target="_blank" rel="noreferrer"><img class="thumb" src="${escapeHtml(repair.photo)}" alt="${escapeHtml(repair.location)}维修照片"></a>` : ""}
      </header>

      ${renderAdvanceSection(repair, archived)}
      ${renderSettleSection(repair, archived)}

      ${renderCardActions(repair, archived)}
    </article>
  `;
}

function renderAdvanceSection(repair, archived) {
  const total = advancesTotal(repair);
  let body;

  if (repair.settlement) {
    body = `
      <ul class="advance-list settled">
        ${repair.settlement.allocations.map((item, index) => `
          <li class="advance-item">
            <span class="advance-index">${index + 1}</span>
            <span class="advance-payer">${escapeHtml(item.payer)}</span>
            <strong class="advance-amount">${formatMoney(item.amount)}</strong>
            <span class="advance-purpose">核销 ${formatMoney(item.used)}</span>
            ${item.refunded > 0 ? `<span class="badge-refund">退 ${formatMoney(item.refunded)}</span>` : `<span class="muted">已冲抵</span>`}
          </li>
        `).join("")}
      </ul>
      ${renderRefundQueue(repair)}
    `;
  } else {
    body = repair.advances.length
      ? `<ul class="advance-list">
          ${repair.advances.map((item, index) => `
            <li class="advance-item">
              <span class="advance-index">${index + 1}</span>
              <span class="advance-payer">${escapeHtml(item.payer)}</span>
              <strong class="advance-amount">${formatMoney(item.amount)}</strong>
              <span class="advance-purpose">${escapeHtml(item.purpose || "未填用途")}</span>
              <span class="advance-time muted">${formatTime(item.createdAt)}</span>
              ${archived ? "" : `<button type="button" class="link-btn" data-delete-advance="${repair.id}" data-advance="${item.id}">删除</button>`}
            </li>
          `).join("")}
        </ul>`
      : `<p class="muted empty-line">还没有垫付记录，师傅上门补付后在这里逐笔登记</p>`;

    if (!archived) {
      body += `
        <form class="advance-form" data-add-advance="${repair.id}">
          <input name="payer" required placeholder="付款人，如 爸爸">
          <input name="amount" type="number" min="0.01" step="0.01" required placeholder="金额">
          <input name="purpose" placeholder="用途，如 上门补付配件费">
          <button class="ghost" type="submit">登记垫付</button>
        </form>
      `;
    }
  }

  return `
    <section class="block">
      <div class="block-head">
        <h4>垫付登记</h4>
        <span class="muted">共 ${repair.advances.length} 笔 · 合计 ${formatMoney(total)}</span>
      </div>
      ${body}
    </section>
  `;
}

// “多出的从最后一笔往前退”的退款顺序说明。
function renderRefundQueue(repair) {
  const queue = refundQueue(repair.settlement);
  if (!queue.length) return "";
  const ordinal = (item) => repair.advances.length - item.indexFromEnd;
  return `<p class="hint">从最后一笔往前退：${queue
    .map((item) => `第${ordinal(item)}笔（${escapeHtml(item.payer)}）退 ${formatMoney(item.refunded)}`)
    .join(" → ")}</p>`;
}

function renderSettleSection(repair, archived) {
  const settlement = repair.settlement;

  if (settlement) {
    return `
      <section class="block">
        <div class="block-head"><h4>结算结果</h4><span class="muted">结清于 ${formatTime(settlement.settledAt)}</span></div>
        <div class="settle-summary">
          <span class="summary-item">实付总额 <strong>${formatMoney(settlement.actualPaid)}</strong></span>
          <span class="summary-item">已垫付 <strong>${formatMoney(settlement.totalAdvance)}</strong></span>
          ${settlement.balanceDue > 0 ? `<span class="badge-warn">尾款待补 ${formatMoney(settlement.balanceDue)}</span>` : ""}
          ${settlement.totalRefund > 0 ? `<span class="badge-refund">应退垫付 ${formatMoney(settlement.totalRefund)}</span>` : `<span class="chip">钱账两清</span>`}
        </div>
      </section>
    `;
  }

  if (archived) {
    return `<section class="block"><p class="hint warn">移除时尚未结清，恢复到事项列表后才能办理结算</p></section>`;
  }

  return `
    <section class="block">
      <div class="block-head"><h4>完工结算</h4></div>
      ${canSettle(repair) ? `
        <form class="settle-form" data-settle="${repair.id}">
          <label>完工实付总额
            <input name="actualPaid" type="number" min="0" step="0.01" required placeholder="填写师傅最终收取的总额">
          </label>
          <button class="primary" type="submit">结清</button>
        </form>
        <p class="hint">按垫付登记顺序逐笔核销：垫付不足记尾款；垫付多出时从最后一笔往前退。</p>
      ` : `
        <p class="hint warn">未完工不能结清：先在下方把状态改为「已完成」。</p>
      `}
    </section>
  `;
}

function renderCardActions(repair, archived) {
  if (archived) {
    return `
      <footer class="actions">
        <button type="button" class="ghost" data-restore="${repair.id}">恢复到事项列表</button>
      </footer>
    `;
  }

  return `
    <footer class="actions">
      <label class="status-select">处理状态
        <select data-status="${repair.id}" ${repair.settlement ? "disabled" : ""}>${renderStatusOptions(repair.status)}</select>
      </label>
      ${repair.settlement ? `<button type="button" class="ghost" data-undo-settle="${repair.id}">撤销结算</button>` : ""}
      <button type="button" class="ghost danger" data-remove="${repair.id}">移除（转入历史账）</button>
    </footer>
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

// ---------- 事件（统一委托，渲染后无需逐个绑定） ----------

function bindEvents() {
  app.addEventListener("submit", (event) => {
    const form = event.target;

    if (form.id === "repair-form") {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      tryAction(() => {
        store.addRepair({
          location: data.location.trim(),
          title: data.title.trim(),
          priority: data.priority,
          cost: data.cost,
          status: data.status,
          photo: data.photo.trim(),
          note: data.note.trim()
        });
      }, "维修事项已保存，可继续登记垫付");
      return;
    }

    if (form.dataset.addAdvance) {
      event.preventDefault();
      const repairId = form.dataset.addAdvance;
      const data = Object.fromEntries(new FormData(form).entries());
      tryAction(() => store.addAdvance(repairId, data), "垫付已登记");
    }

    if (form.dataset.settle) {
      event.preventDefault();
      const repairId = form.dataset.settle;
      const data = new FormData(form).get("actualPaid");
      tryAction(() => store.settle(repairId, data), "已结清");
    }
  });

  app.addEventListener("change", (event) => {
    const select = event.target.closest("[data-status]");
    if (select) tryAction(() => store.updateStatus(select.dataset.status, select.value));
  });

  app.addEventListener("click", (event) => {
    const filterButton = event.target.closest("[data-filter]");
    if (filterButton) {
      store.setFilter(filterButton.dataset.filter);
      notice = null;
      render();
      return;
    }

    const deleteAdvance = event.target.closest("[data-delete-advance]");
    if (deleteAdvance) {
      tryAction(() => store.deleteAdvance(deleteAdvance.dataset.deleteAdvance, deleteAdvance.dataset.advance), "垫付已删除");
      return;
    }

    const undoSettle = event.target.closest("[data-undo-settle]");
    if (undoSettle) {
      tryAction(() => store.undoSettlement(undoSettle.dataset.undoSettle), "结算已撤销，可重新填写实付总额");
      return;
    }

    const remove = event.target.closest("[data-remove]");
    if (remove) {
      tryAction(() => store.removeRepair(remove.dataset.remove), "事项已转入历史账");
      return;
    }

    const restore = event.target.closest("[data-restore]");
    if (restore) {
      tryAction(() => store.restoreRepair(restore.dataset.restore), "已恢复到事项列表");
    }
  });
}
