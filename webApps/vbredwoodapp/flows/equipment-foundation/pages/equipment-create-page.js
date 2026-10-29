define([], () => {
  'use strict';

  // ─── DROPDOWN DATA ARRAYS ───
  const OWNING_ORGS = [
    { value: "Corp Equipment Div", label: "Corp Equipment Div" },
    { value: "Gulf Coast Operations", label: "Gulf Coast Operations" },
    { value: "Pacific Division BU", label: "Pacific Division BU" },
    { value: "Atlantic Region", label: "Atlantic Region" },
    { value: "Midwest Equipment Group", label: "Midwest Equipment Group" }
  ];

  const EQUIP_TYPES = [
    { value: "Backhoe", label: "Backhoe" },
    { value: "Crane", label: "Crane" },
    { value: "Excavator", label: "Excavator" },
    { value: "Truck", label: "Truck" },
    { value: "ROV", label: "ROV" },
    { value: "Compressor", label: "Compressor" },
    { value: "Pump", label: "Pump" }
  ];

  const EQUIP_CLASSES = [
    { value: "BACKHOE", label: "BACKHOE" },
    { value: "CRAWLER_CRANE", label: "CRAWLER_CRANE" },
    { value: "EXCAVATOR", label: "EXCAVATOR" },
    { value: "FLEET_TRUCK", label: "FLEET_TRUCK" },
    { value: "HEAVY_HAULING", label: "HEAVY_HAULING" },
    { value: "ROV", label: "ROV" },
    { value: "SMALL_TOOLS", label: "SMALL_TOOLS" },
    { value: "LIGHT_WATER_PUMPS", label: "LIGHT_WATER_PUMPS" }
  ];

  const EQUIP_SUBCLASSES = [
    { value: "Backhoe", label: "Backhoe" },
    { value: "Crawler Crane", label: "Crawler Crane" },
    { value: "Excavator", label: "Excavator" },
    { value: "Flat Deck", label: "Flat Deck" },
    { value: "ROV", label: "ROV" },
    { value: "Rotary Hammer", label: "Rotary Hammer" },
    { value: "Water Pump", label: "Water Pump" },
    { value: "Compressor", label: "Compressor" }
  ];

  const OWNER_TYPES = [
    { value: "Company-Owned", label: "Company-Owned" },
    { value: "Leased", label: "Leased" },
    { value: "Rented", label: "Rented" }
  ];

  const STATUS_OPTIONS = [
    { value: "Available", label: "Available" },
    { value: "In Maintenance", label: "In Maintenance" },
    { value: "Deployed", label: "Deployed" },
    { value: "Retired", label: "Retired" }
  ];

  const POS = [
    { value: "PO-2024-001", label: "PO-2024-001" },
    { value: "PO-2024-002", label: "PO-2024-002" },
    { value: "PO-2025-001", label: "PO-2025-001" },
    { value: "PO-2025-002", label: "PO-2025-002" }
  ];

  const UOMS = [
    { value: "EA", label: "EA" },
    { value: "SET", label: "SET" },
    { value: "LOT", label: "LOT" }
  ];

  const FUEL_TYPES = [
    { value: "Diesel", label: "Diesel" },
    { value: "Gasoline", label: "Gasoline" },
    { value: "Electric", label: "Electric" },
    { value: "Hybrid", "label": "Hybrid" },
    { value: "N/A", "label": "N/A" }
  ];

  const LOCATIONS = [
    { value: "Yard A — New York", label: "Yard A — New York" },
    { value: "Yard B — Los Angeles", label: "Yard B — Los Angeles" },
    { value: "Yard C — Los Angeles CA", label: "Yard C — Los Angeles CA" },
    { value: "Site A, Houston TX", label: "Site A, Houston TX" },
    { value: "New York Alpha", label: "New York Alpha" },
    { value: "California Omega", label: "California Omega" }
  ];

  const BUS = [
    { value: "Pacific Division BU", label: "Pacific Division BU" },
    { value: "Atlantic Division BU", label: "Atlantic Division BU" },
    { value: "Gulf Coast BU", label: "Gulf Coast BU" },
    { value: "Midwest BU", label: "Midwest BU" },
    { value: "Corporate", label: "Corporate" }
  ];

  const EXPENDITURE_ORGS = [
    { value: "Corp Equipment Div", label: "Corp Equipment Div" },
    { value: "Gulf Coast Operations", label: "Gulf Coast Operations" },
    { value: "Pacific Division BU", label: "Pacific Division BU" }
  ];

  const BILLING_CATEGORIES = [
    { value: "Equipment Usage", label: "Equipment Usage" },
    { value: "Equipment Rental", label: "Equipment Rental" },
    { value: "Heavy Machinery", label: "Heavy Machinery" },
    { value: "Small Tools", label: "Small Tools" }
  ];

  const RENTAL_POS = [
    { value: "RPO-2024-001", label: "RPO-2024-001" },
    { value: "RPO-2024-002", label: "RPO-2024-002" },
    { value: "RPO-2025-001", label: "RPO-2025-001" }
  ];

  class PageModule {
    getOrgData() { return OWNING_ORGS; }
    getTypeData() { return EQUIP_TYPES; }
    getClassData() { return EQUIP_CLASSES; }
    getSubclassData() { return EQUIP_SUBCLASSES; }
    getOwnerTypeData() { return OWNER_TYPES; }
    getStatusData() { return STATUS_OPTIONS; }
    getPOData() { return POS; }
    getUOMData() { return UOMS; }
    getFuelData() { return FUEL_TYPES; }
    getLocationData() { return LOCATIONS; }
    getBUData() { return BUS; }
    getExpenditureOrgData() { return EXPENDITURE_ORGS; }
    getBillingData() { return BILLING_CATEGORIES; }
    getRentalPOData() { return RENTAL_POS; }
  }

  return PageModule;
});
