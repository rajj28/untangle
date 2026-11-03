// The demo town: who owes whom on Main Street. Slots match PAYPAL_BIZ_{n} in .env.
// Amounts are whole dollars here; the seed converts them to cents.

export interface SeedInvoice {
  debtor: number;
  creditor: number;
  dollars: number;
  item: string;
  dueInDays: number;
}

export const mainStreetBusinesses = [
  { slot: 1, name: "Rosa's Bakery" },
  { slot: 2, name: "Rossi Mill" },
  { slot: 3, name: "Ortega Trucking" },
  { slot: 4, name: "Corner Cafe" },
  { slot: 5, name: "Green Valley Dairy" },
  { slot: 6, name: "Bean & Leaf Roasters" },
  { slot: 7, name: "Main St Print Shop" },
  { slot: 8, name: "Sparkle Cleaning Co" },
  { slot: 9, name: "Lee & Patel Accounting" },
] as const;

export const mainStreetInvoices: readonly SeedInvoice[] = [
  { debtor: 1, creditor: 2, dollars: 3000, item: "Bread flour, 40 × 25 kg bags", dueInDays: 21 },
  { debtor: 2, creditor: 3, dollars: 2400, item: "Freight: October grain deliveries", dueInDays: 14 },
  { debtor: 3, creditor: 1, dollars: 2800, item: "Catering for the depot open day", dueInDays: 30 },
  { debtor: 4, creditor: 1, dollars: 1200, item: "Pastries, October standing order", dueInDays: 14 },
  { debtor: 4, creditor: 6, dollars: 1600, item: "House espresso blend, 60 kg", dueInDays: 21 },
  { debtor: 4, creditor: 5, dollars: 900, item: "Whole milk and cream, October", dueInDays: 14 },
  { debtor: 1, creditor: 5, dollars: 1200, item: "Butter and cream, October", dueInDays: 21 },
  { debtor: 5, creditor: 3, dollars: 1600, item: "Refrigerated freight, October", dueInDays: 30 },
  { debtor: 6, creditor: 3, dollars: 1200, item: "Green coffee haulage from port", dueInDays: 30 },
  { debtor: 6, creditor: 7, dollars: 800, item: "Printed coffee bags, 5,000 units", dueInDays: 21 },
  { debtor: 7, creditor: 6, dollars: 400, item: "Office coffee subscription", dueInDays: 30 },
  { debtor: 4, creditor: 7, dollars: 650, item: "Menu boards and loyalty cards", dueInDays: 30 },
  { debtor: 4, creditor: 8, dollars: 400, item: "Deep clean, kitchen and dining room", dueInDays: 14 },
  { debtor: 1, creditor: 8, dollars: 700, item: "Weekly bakery cleaning, October", dueInDays: 14 },
  { debtor: 7, creditor: 8, dollars: 550, item: "Shop floor cleaning", dueInDays: 30 },
  { debtor: 2, creditor: 9, dollars: 1400, item: "Q3 bookkeeping and payroll", dueInDays: 30 },
  { debtor: 3, creditor: 9, dollars: 600, item: "Fleet tax filing", dueInDays: 30 },
  { debtor: 5, creditor: 9, dollars: 400, item: "Q3 bookkeeping", dueInDays: 30 },
  { debtor: 8, creditor: 9, dollars: 1000, item: "Payroll service, October", dueInDays: 30 },
  { debtor: 9, creditor: 1, dollars: 900, item: "Client event catering", dueInDays: 21 },
  { debtor: 9, creditor: 4, dollars: 950, item: "Team coffee account, October", dueInDays: 21 },
  { debtor: 9, creditor: 8, dollars: 350, item: "Office cleaning, October", dueInDays: 14 },
  { debtor: 3, creditor: 4, dollars: 1800, item: "Driver coffee and breakfast tab", dueInDays: 21 },
  { debtor: 5, creditor: 2, dollars: 800, item: "Feed grain, 5 tonnes", dueInDays: 21 },
  { debtor: 7, creditor: 4, dollars: 500, item: "Staff coffee and lunch tab", dueInDays: 21 },
];
