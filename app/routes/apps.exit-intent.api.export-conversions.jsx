import { authenticate } from "../shopify.server";
import db from "../db.server";
import ExcelJS from 'exceljs';

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const range = url.searchParams.get("range") || "30d";
  
  // Get shop record
  const shopRecord = await db.shop.findUnique({
    where: { shopifyDomain: session.shop }
  });
  
  if (!shopRecord) {
    return new Response("Shop not found", { status: 404 });
  }
  
  // Calculate date filter
  let dateFilter = {};
  if (range === '7d') {
    dateFilter = { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) };
  } else if (range === '30d') {
    dateFilter = { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };
  }
  
  // Get conversions
  const conversions = await db.conversion.findMany({
    where: {
      shopId: shopRecord.id,
      ...(Object.keys(dateFilter).length > 0 && { orderedAt: dateFilter })
    },
    orderBy: { orderedAt: 'desc' }
  });
  
  // Create workbook
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Conversions');
  
  // Add header row
  worksheet.columns = [
    { header: 'Date', key: 'date', width: 15 },
    { header: 'Time', key: 'time', width: 12 },
    { header: 'Order #', key: 'orderNumber', width: 15 },
    { header: 'Customer Email', key: 'email', width: 30 },
    { header: 'Order Value', key: 'value', width: 15 },
    { header: 'Modal Had Discount', key: 'hadDiscount', width: 20 },
    { header: 'Discount Redeemed', key: 'redeemed', width: 20 },
    { header: 'Discount Amount', key: 'amount', width: 18 }
  ];
  
  // Add data rows
  conversions.forEach(c => {
    worksheet.addRow({
      date: new Date(c.orderedAt).toLocaleDateString(),
      time: new Date(c.orderedAt).toLocaleTimeString(),
      orderNumber: c.orderNumber,
      email: c.customerEmail || 'N/A',
      value: `$${c.orderValue}`,
      hadDiscount: c.modalHadDiscount ? 'Yes' : 'No',
      redeemed: c.modalHadDiscount ? (c.discountRedeemed ? 'Yes' : 'No') : 'N/A',
      amount: c.modalHadDiscount && c.discountAmount ? `$${c.discountAmount}` : 'N/A'
    });
  });
  
  // Generate Excel file
  const buffer = await workbook.xlsx.writeBuffer();
  
  // Return as downloadable file
  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="resparq-conversions-${new Date().toISOString().split('T')[0]}.xlsx"`
    }
  });
};
