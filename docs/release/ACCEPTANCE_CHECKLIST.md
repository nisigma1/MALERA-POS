# Terminal acceptance checklist

- Confirm the exact source commit, installer checksum, application version and signed/unsigned channel.
- Run automated tests, type checking and build checks.
- Verify the packaged native SQLite recovery module, fresh production state and installed-app acceptance.
- Confirm all 27 service positions and their owner-facing labels.
- Confirm stock, reports and cash totals reconcile through checkout and repeated actions.
- Check open-order recovery after a controlled restart and preservation through update/reinstall.
- Check the actual display, finger input, scrolling, date/number entry and on-screen keyboard.
- Enter owner-approved selling prices, stock-tracking settings and starting quantities. Unknown costs remain unknown.
- Configure the business name and actual receipt printer; test paper width, physical output and disconnected-printer behavior.
- Make a verified pre-go-live backup and keep an independent off-device copy.
- Verify the update task, configured `main` branch, staged-download behavior and backup-before-install path.
- Keep unresolved failures visible. The offscreen capture harness issue on Engage Go and absence of physical printer tests must not be reported as passed checks.
