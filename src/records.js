// 记录层：维修事项与垫付笔次的登记、结算落账、历史账与本地持久化。
import { canSettle, computeSettlement, parseActualPaid, roundMoney } from "./settlement.js";

const STORAGE_KEY = "zfl-14-repairs";

function makeId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createSeedAdvances() {
  const now = Date.now();
  return [
    {
      id: makeId(),
      payer: "爸爸",
      amount: 200,
      purpose: "先付定金锁师傅档期",
      createdAt: now - 1000 * 60 * 60
    },
    {
      id: makeId(),
      payer: "妈妈",
      amount: 100,
      purpose: "上门后补付软管与接头",
      createdAt: now - 1000 * 60 * 30
    }
  ];
}

function createDefaultState() {
  return {
    filter: "all",
    repairs: [
      {
        id: makeId(),
        location: "厨房",
        title: "水槽下方渗水",
        priority: "high",
        cost: 260,
        status: "todo",
        photo: "",
        note: "先检查软管接口",
        createdAt: Date.now(),
        advances: createSeedAdvances(),
        settlement: null
      }
    ],
    history: []
  };
}

function normalizeAdvance(advance) {
  return {
    id: advance.id || makeId(),
    payer: String(advance.payer || "").trim(),
    amount: roundMoney(advance.amount),
    purpose: String(advance.purpose || "").trim(),
    createdAt: advance.createdAt || Date.now()
  };
}

// 兼容第一版数据：老事项没有 advances / settlement / createdAt 字段，补齐即可。
function normalizeRepair(repair) {
  return {
    id: repair.id || makeId(),
    location: String(repair.location || ""),
    title: String(repair.title || ""),
    priority: repair.priority || "medium",
    cost: roundMoney(repair.cost),
    status: repair.status || "todo",
    photo: String(repair.photo || ""),
    note: String(repair.note || ""),
    createdAt: repair.createdAt || Date.now(),
    advances: Array.isArray(repair.advances) ? repair.advances.map(normalizeAdvance) : [],
    settlement: repair.settlement || null
  };
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      return {
        filter: parsed.filter || "all",
        repairs: Array.isArray(parsed.repairs) ? parsed.repairs.map(normalizeRepair) : [],
        history: Array.isArray(parsed.history) ? parsed.history.map(normalizeRepair) : []
      };
    } catch {
      // 存档损坏时回到初始示例，不阻塞页面。
    }
  }
  return createDefaultState();
}

export const store = {
  state: loadState(),

  save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
  },

  setFilter(filter) {
    this.state.filter = filter;
    this.save();
  },

  addRepair(data) {
    const repair = normalizeRepair({
      ...data,
      cost: roundMoney(data.cost),
      status: data.status || "todo",
      createdAt: Date.now(),
      advances: [],
      settlement: null
    });
    this.state.repairs.unshift(repair);
    this.save();
    return repair;
  },

  updateStatus(repairId, status) {
    const repair = this.state.repairs.find((item) => item.id === repairId);
    if (!repair) throw new Error("没有找到这项维修");
    // 已结清的事项状态被锁定，避免“未完工结清”后又改动。
    if (repair.settlement) throw new Error("已结清的事项不能再改状态，如需调整请先撤销结算");
    repair.status = status;
    this.save();
  },

  addAdvance(repairId, data) {
    const repair = this.state.repairs.find((item) => item.id === repairId);
    if (!repair) throw new Error("没有找到这项维修");
    if (repair.settlement) throw new Error("已结清，不能再补登记垫付");
    const payer = String(data.payer || "").trim();
    if (!payer) throw new Error("请填写付款人");
    const amount = roundMoney(data.amount);
    if (!(amount > 0)) throw new Error("垫付金额必须大于 0");
    repair.advances.push({
      id: makeId(),
      payer,
      amount,
      purpose: String(data.purpose || "").trim(),
      createdAt: Date.now()
    });
    this.save();
  },

  deleteAdvance(repairId, advanceId) {
    const repair = this.state.repairs.find((item) => item.id === repairId);
    if (!repair) throw new Error("没有找到这项维修");
    if (repair.settlement) throw new Error("已结清，不能删除垫付");
    repair.advances = repair.advances.filter((item) => item.id !== advanceId);
    this.save();
  },

  settle(repairId, actualPaidInput) {
    const repair = this.state.repairs.find((item) => item.id === repairId);
    if (!repair) throw new Error("没有找到这项维修");
    if (!canSettle(repair)) throw new Error("只有已完成的维修事项才能结清");
    const actualPaid = parseActualPaid(actualPaidInput);
    repair.settlement = {
      ...computeSettlement(repair.advances, actualPaid),
      settledAt: Date.now()
    };
    this.save();
  },

  undoSettlement(repairId) {
    const repair = this.state.repairs.find((item) => item.id === repairId);
    if (!repair || !repair.settlement) throw new Error("这项维修还没有结清");
    repair.settlement = null;
    this.save();
  },

  // 移除事项：连同垫付与结算结果一起转入历史账，重开页面仍可查看。
  removeRepair(repairId) {
    const index = this.state.repairs.findIndex((item) => item.id === repairId);
    if (index === -1) throw new Error("没有找到这项维修");
    const [removed] = this.state.repairs.splice(index, 1);
    removed.archivedAt = Date.now();
    this.state.history.unshift(removed);
    if (this.state.filter === removed.status) this.state.filter = "all";
    this.save();
  },

  // 从历史账恢复为活动事项。
  restoreRepair(repairId) {
    const index = this.state.history.findIndex((item) => item.id === repairId);
    if (index === -1) throw new Error("历史账里没有这项维修");
    const [restored] = this.state.history.splice(index, 1);
    delete restored.archivedAt;
    this.state.repairs.unshift(restored);
    this.state.filter = "all";
    this.save();
  }
};
