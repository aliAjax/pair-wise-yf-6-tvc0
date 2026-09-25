// 记录：维修事项、垫付登记与历史账的本地台账（localStorage）
const STORAGE_KEY = "zfl-14-repairs";

export const statuses = {
  all: "全部",
  todo: "待处理",
  doing: "处理中",
  done: "已完成"
};

export const priorities = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级"
};

let state = loadState();

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const parsed = JSON.parse(saved);
    return {
      filter: parsed.filter || "all",
      repairs: (parsed.repairs || []).map(normalizeRepair),
      history: (parsed.history || []).map(normalizeRepair)
    };
  }
  return {
    filter: "all",
    repairs: [
      normalizeRepair({
        id: crypto.randomUUID(),
        location: "厨房",
        title: "水槽下方渗水",
        priority: "high",
        status: "doing",
        note: "先检查软管接口",
        advances: [
          { payer: "妈妈", amount: 200, purpose: "买软管和密封胶" },
          { payer: "爸爸", amount: 150, purpose: "师傅上门费" }
        ]
      }),
      normalizeRepair({
        id: crypto.randomUUID(),
        location: "卫生间",
        title: "花洒出水忽冷忽热",
        priority: "medium",
        status: "done",
        note: "阀芯已换，待结算",
        advances: [{ payer: "自己", amount: 300, purpose: "更换阀芯材料费" }]
      })
    ],
    history: []
  };
}

function normalizeRepair(repair) {
  return {
    ...repair,
    note: repair.note || "",
    advances: (repair.advances || []).map(normalizeAdvance),
    settlement: repair.settlement || null
  };
}

function normalizeAdvance(advance) {
  return {
    id: advance.id || crypto.randomUUID(),
    payer: advance.payer || "",
    amount: Number(advance.amount || 0),
    purpose: advance.purpose || "",
    createdAt: advance.createdAt || new Date().toISOString()
  };
}

function findRepair(id) {
  return state.repairs.find((repair) => repair.id === id);
}

export function getState() {
  return state;
}

export function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function setFilter(filter) {
  state.filter = filter;
  saveState();
}

export function addRepair(data) {
  state.repairs.unshift({
    id: crypto.randomUUID(),
    location: data.location,
    title: data.title,
    priority: data.priority,
    status: "todo",
    note: data.note,
    advances: [],
    settlement: null,
    createdAt: new Date().toISOString()
  });
  saveState();
}

export function setStatus(id, status) {
  const repair = findRepair(id);
  if (!repair || repair.settlement) return; // 已结清的事项锁定状态
  repair.status = status;
  saveState();
}

export function addAdvance(repairId, advance) {
  const repair = findRepair(repairId);
  if (!repair || repair.settlement) return; // 已结清不能再登记
  repair.advances.push(
    normalizeAdvance({ ...advance, id: crypto.randomUUID(), createdAt: new Date().toISOString() })
  );
  saveState();
}

export function removeAdvance(repairId, advanceId) {
  const repair = findRepair(repairId);
  if (!repair || repair.settlement) return;
  repair.advances = repair.advances.filter((advance) => advance.id !== advanceId);
  saveState();
}

export function saveSettlement(repairId, settlement) {
  const repair = findRepair(repairId);
  if (!repair) return;
  repair.settlement = settlement;
  saveState();
}

export function clearSettlement(repairId) {
  const repair = findRepair(repairId);
  if (!repair) return;
  repair.settlement = null;
  saveState();
}

// 移除事项：整笔记录（含垫付与结算单）转入历史账
export function removeRepair(id) {
  const repair = findRepair(id);
  if (!repair) return;
  state.repairs = state.repairs.filter((item) => item.id !== id);
  state.history.unshift({ ...repair, removedAt: new Date().toISOString() });
  saveState();
}

export function restoreRepair(id) {
  const item = state.history.find((repair) => repair.id === id);
  if (!item) return;
  state.history = state.history.filter((repair) => repair.id !== id);
  const { removedAt, ...repair } = item;
  state.repairs.unshift(repair);
  saveState();
}
