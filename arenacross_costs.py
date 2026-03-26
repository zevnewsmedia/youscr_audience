import pandas as pd
import os

# ---------- Data ----------

# Daily Costs
daily_costs_data = {
    'Phase': ['Development', 'Prep Weeks', 'Event Days'],
    'Days': [85, 15, 5],
    'EC2 Cost (BRL)': [0.60, 7, 4.20],
    'DB Atlas (BRL)': [0.42, 5, 5.30],
    'DB Self-Managed (BRL)': [0.06, 0.72, 3.80],
    'Load Balancer (BRL)': [0, 0, 13.80],
    'Storage/CDN (BRL)': [0, 10, 50],
    'Extras (BRL)': [0.50, 2, 4]
}
daily_costs = pd.DataFrame(daily_costs_data)
daily_costs['Total Atlas'] = daily_costs['EC2 Cost (BRL)'] + daily_costs['DB Atlas (BRL)'] + daily_costs['Load Balancer (BRL)'] + daily_costs['Storage/CDN (BRL)'] + daily_costs['Extras (BRL)']
daily_costs['Total Self-Managed'] = daily_costs['EC2 Cost (BRL)'] + daily_costs['DB Self-Managed (BRL)'] + daily_costs['Load Balancer (BRL)'] + daily_costs['Storage/CDN (BRL)'] + daily_costs['Extras (BRL)']

# Total Costs
total_costs_data = {
    'Phase': ['Development', 'Prep Weeks', 'Event Days', 'Season Total'],
    'Atlas Total (BRL)': [
        daily_costs['Total Atlas'][0]*85,
        daily_costs['Total Atlas'][1]*15,
        daily_costs['Total Atlas'][2]*5,
        daily_costs['Total Atlas'].dot(daily_costs['Days'])
    ],
    'Self-Managed Total (BRL)': [
        daily_costs['Total Self-Managed'][0]*85,
        daily_costs['Total Self-Managed'][1]*15,
        daily_costs['Total Self-Managed'][2]*5,
        daily_costs['Total Self-Managed'].dot(daily_costs['Days'])
    ]
}
total_costs = pd.DataFrame(total_costs_data)

# Notes
notes_data = {
    'Notes': [
        'Development: 5h/day, 5 days/week',
        'Prep Weeks: 12h/day, 5 days/event',
        'Event Days: 10h/day, full load',
        '40% safety buffer included',
        'Load balancer only during event days',
        'Storage/CDN estimated for high fan traffic during events'
    ]
}
notes = pd.DataFrame(notes_data)

# ---------- Save Files ----------

try:
    # Try saving Excel
    with pd.ExcelWriter('youscr_aws_forecast.xlsx') as writer:
        daily_costs.to_excel(writer, sheet_name='Daily Costs', index=False)
        total_costs.to_excel(writer, sheet_name='Total Costs', index=False)
        notes.to_excel(writer, sheet_name='Notes', index=False)
    print("✅ Excel file 'youscr_aws_forecast.xlsx' created successfully in the current folder.")
except Exception as e:
    print(f"⚠️ Excel export failed ({e}). Saving CSVs instead...")
    daily_costs.to_csv('youscr_daily_costs.csv', index=False)
    total_costs.to_csv('youscr_total_costs.csv', index=False)
    notes.to_csv('youscr_notes.csv', index=False)
    print("✅ CSV files created: 'youscr_daily_costs.csv', 'youscr_total_costs.csv', 'youscr_notes.csv' in the current folder.")

