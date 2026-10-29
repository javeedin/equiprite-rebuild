define([], () => {
  'use strict';

  class PageModule {
    /**
     * Maps API equipment data to UI fields
     */
    mapEquipmentData(apiData) {
      if (!apiData) return null;
      return {
        equipment_id: apiData.id,
        equipment_name: apiData.equipmentName,
        equipment_class: apiData.equipmentClassId,
        equipment_subclass: apiData.equipmentSubclassId,
        equipment_type: apiData.equipmentType,
        serial_number: apiData.engineSn,
        status: apiData.status || '',
        owner_type: apiData.ownershipStatus || '',
        model_year: apiData.mfgYear,
        is_fixed_asset_tracked: apiData.isFixedAssetTracked || 'N',
        is_inventory_tracked: apiData.isInventoryTracked || 'N',
        is_maintenance_tracked: apiData.isMaintenanceTracked || 'N',
        surplus_flag: apiData.surplusFlag || 'N',
        capacity: apiData.capacity || '',
        fa_asset_number: apiData.faAssetRefId,
        maintenance_asset_id: apiData.maintenanceAssetNumber,
        inventory_item_id: apiData.inventoryItemRefId,
        location: apiData.currentLocationId,
        owning_org: apiData.orgId,
        manufacturer: '',
        uom: '',
        acquisition_cost: null,
        fuel_type: apiData.fuelType || '',
        serial_controlled: apiData.isSerialControlled || 'N',
        gps_unit_id: apiData.attribute1 || '',
        library_ref: apiData.attribute2 || '',
        fleet_identifier: apiData.attribute3 || '',
        replacement_cost: apiData.number1,
        next_inspection_date: apiData.date1
      };
    }

    /**
     * Formats a number as a currency string (USD).
     * @param {number|string} value
     * @returns {string}
     */
    formatCurrency(value) {
      if (value === null || value === undefined || value === '') return '—';
      return '$' + Number(value).toLocaleString();
    }
  }

  return PageModule;
});
