"""
Add live-disrupted maritime shipments and complete ERP relational data into mock_erp.db
"""
import config
import sqlite3

def populate_live_disruptions():
    conn = config.get_db_connection()

    # 1. Add Suppliers
    conn.execute("""
        INSERT OR IGNORE INTO suppliers 
        (supplier_id, supplier_name, location, approved, lead_time_days, moq, capacity_per_day, unit_cost, export_restricted, freight_cost_air, freight_cost_sea)
        VALUES 
        ('SUP-007', 'Al-Bahar Industrial Components', 'Jeddah, Saudi Arabia', 1, 18, 300, 500, 120.0, 0, 18.5, 4.0),
        ('SUP-008', 'Ningbo Precision Rotor Tech', 'Ningbo, China', 1, 14, 400, 1000, 35.0, 0, 12.0, 2.5),
        ('SUP-009', 'Munich Semiconductor Express', 'Munich, Germany', 1, 8, 100, 2000, 140.0, 0, 28.0, 7.0),
        ('SUP-010', 'Kyoto Precision Rotors', 'Kyoto, Japan', 1, 9, 200, 1500, 42.0, 0, 16.0, 3.5)
    """)

    # 2. Add Materials
    conn.execute("""
        INSERT OR IGNORE INTO materials (material_id, material_name, material_type, unit, unit_cost, compatible_revisions)
        VALUES 
        ('CTRL-MOD-800', 'Main Microcontroller Module 800', 'COMPONENT', 'EA', 120.0, 'REV-D,REV-E'),
        ('ROTOR-220', 'Precision Rotor Core 220mm', 'COMPONENT', 'EA', 35.0, 'REV-D')
    """)

    # 3. Add BOM links
    conn.execute("""
        INSERT OR IGNORE INTO bom (parent_material_id, component_material_id, quantity_per, revision)
        VALUES 
        ('CTRL-BOARD-100', 'CTRL-MOD-800', 1.0, 'REV-D'),
        ('MOTOR-ASM-100', 'ROTOR-220', 1.0, 'REV-D')
    """)

    # 4. Add Inventory
    conn.execute("""
        INSERT OR IGNORE INTO inventory (material_id, location, on_hand_qty, reserved_qty, daily_consumption, safety_stock)
        VALUES 
        ('CTRL-MOD-800', 'Chennai Plant - Electronics Stores', 150, 0, 30.0, 50),
        ('ROTOR-220', 'Chennai Plant - Machining Stores', 600, 0, 50.0, 100)
    """)

    # 5. Add Purchase Orders
    conn.execute("""
        INSERT OR IGNORE INTO purchase_orders (po_id, supplier_id, material_id, quantity, order_date, expected_date, unit_cost, status)
        VALUES 
        ('PO-8100', 'SUP-007', 'CTRL-MOD-800', 500, '2026-09-15', '2026-10-14', 120.0, 'IN_TRANSIT'),
        ('PO-9200', 'SUP-008', 'ROTOR-220', 800, '2026-09-20', '2026-10-12', 35.0, 'IN_TRANSIT')
    """)

    # 6. Add Shipments
    conn.execute("""
        INSERT OR IGNORE INTO shipments (shipment_id, po_id, origin, destination, vessel_name, original_eta, status)
        VALUES 
        ('SHIP-8100', 'PO-8100', 'Red Sea', 'Chennai', 'CMA CGM Palais', '2026-10-14', 'IN_TRANSIT'),
        ('SHIP-9200', 'PO-9200', 'Ningbo', 'Chennai', 'Ever Given', '2026-10-12', 'IN_TRANSIT')
    """)

    # 7. Add Customer Orders
    conn.execute("""
        INSERT OR IGNORE INTO customer_orders (customer_order_id, customer_name, material_id, quantity, requested_date, unit_price, status)
        VALUES 
        ('SO-55120', 'Siemens Energy Mobility', 'APEXM-100', 300, '2026-10-22', 450.0, 'OPEN'),
        ('SO-55130', 'General Electric Systems', 'APEXM-100', 400, '2026-10-24', 320.0, 'OPEN')
    """)

    # 8. Add Work Orders
    conn.execute("""
        INSERT OR IGNORE INTO work_orders (work_order_id, finished_material_id, planned_quantity, planned_start, planned_end, status, customer_order_id, frozen_schedule)
        VALUES 
        ('WO-7790', 'APEXM-100', 300, '2026-10-15', '2026-10-18', 'FIRM', 'SO-55120', 1),
        ('WO-7795', 'APEXM-100', 400, '2026-10-16', '2026-10-19', 'FIRM', 'SO-55130', 1)
    """)

    # 9. Add WO Materials (Pegging)
    conn.execute("""
        INSERT OR IGNORE INTO wo_materials (work_order_id, material_id, required_qty, allocated_qty, shortage_qty)
        VALUES 
        ('WO-7790', 'CTRL-MOD-800', 300, 0, 300),
        ('WO-7795', 'ROTOR-220', 400, 0, 400)
    """)

    # 10. Add Supplier Certifications
    conn.execute("""
        INSERT OR IGNORE INTO supplier_certifications (supplier_id, material_id, cert_type, product_family, valid_until, status)
        VALUES 
        ('SUP-007', 'CTRL-MOD-800', 'PPAP', 'ApexX-100', '2027-12-31', 'VALID'),
        ('SUP-008', 'ROTOR-220', 'PPAP', 'ApexX-100', '2027-12-31', 'VALID'),
        ('SUP-009', 'CTRL-MOD-800', 'PPAP', 'ApexX-100', '2027-12-31', 'VALID'),
        ('SUP-010', 'ROTOR-220', 'PPAP', 'ApexX-100', '2027-12-31', 'VALID')
    """)

    # 11. Add Recovery Option Templates
    conn.execute("""
        INSERT OR IGNORE INTO recovery_option_templates (option_id, option_type, supplier_id, material_id, description, freight_mode, lead_time_days, estimated_cost)
        VALUES 
        ('OPT-REDSEA-A', 'SPOT_BUY', 'SUP-009', 'CTRL-MOD-800', 'Air freight express spot-buy of 500 units CTRL-MOD-800 from Munich Semiconductor Express. 8-day lead time.', 'AIR', 8, 26000.0),
        ('OPT-NINGBO-A', 'SPOT_BUY', 'SUP-010', 'ROTOR-220', 'Air freight express spot-buy of 800 units ROTOR-220 from Kyoto Precision Rotors. 9-day lead time.', 'AIR', 9, 22400.0)
    """)

    conn.commit()
    conn.close()
    print("Successfully populated live disruption scenarios (Red Sea SHIP-8100 and Ningbo SHIP-9200) across all related tables!")

if __name__ == "__main__":
    populate_live_disruptions()
