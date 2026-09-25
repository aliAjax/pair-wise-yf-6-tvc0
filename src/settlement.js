// 结算层：只负责算账，不碰 DOM 和存储。
// 金额内部统一用“分”做整数运算，避免浮点误差。

export function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function toCents(value) {
  return Math.round(Number(value || 0) * 100);
}

function toYuan(cents) {
  return cents / 100;
}

// 只有“已完成”的事项允许结清。
export function canSettle(repair) {
  return Boolean(repair) && repair.status === "done";
}

// 校验实付总额输入，返回数字（元），不合法时抛错。
export function parseActualPaid(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("请输入正确的实付总额");
  }
  return roundMoney(amount);
}

// 按垫付的登记顺序逐笔核销：
//   1) 前面的垫付优先冲抵实付总额；
//   2) 垫到一半够用了，后面的笔整笔退款，天然就是“从最后一笔往前退”；
//   3) 所有垫付用完仍不够，差额记为尾款。
export function computeSettlement(advances, actualPaid) {
  const actualPaidCents = toCents(actualPaid);
  let remaining = Math.max(0, actualPaidCents);

  const allocations = advances.map((advance) => {
    const amountCents = toCents(advance.amount);
    const usedCents = Math.min(amountCents, remaining);
    remaining -= usedCents;
    return {
      advanceId: advance.id,
      payer: advance.payer,
      amount: toYuan(amountCents),
      used: toYuan(usedCents),
      refunded: toYuan(amountCents - usedCents)
    };
  });

  const totalAdvanceCents = advances.reduce((sum, advance) => sum + toCents(advance.amount), 0);
  const totalUsedCents = allocations.reduce((sum, item) => sum + toCents(item.used), 0);
  const totalRefundCents = allocations.reduce((sum, item) => sum + toCents(item.refunded), 0);

  return {
    actualPaid: toYuan(actualPaidCents),
    totalAdvance: toYuan(totalAdvanceCents),
    totalUsed: toYuan(totalUsedCents),
    balanceDue: toYuan(Math.max(0, remaining)),
    totalRefund: toYuan(totalRefundCents),
    allocations
  };
}

// 生成“从末笔往前退”的退款序列，供页面展示。
export function refundQueue(settlement) {
  return [...settlement.allocations]
    .reverse()
    .map((item, indexFromEnd) => ({ ...item, indexFromEnd }))
    .filter((item) => toCents(item.refunded) > 0);
}
