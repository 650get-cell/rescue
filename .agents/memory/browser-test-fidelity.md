---
name: Browser test fidelity
description: Prevent DOM test doubles from hiding startup failures in standalone HTML pages.
---

DOM test doubles must return null for nonexistent elements and account for which markup has been parsed when an inline script executes.

**Why:** A permissive test double invented every requested element, allowing regression checks to pass while the browser crashed registering handlers for form markup located after the script.

**How to apply:** For standalone HTML script tests, derive available IDs from actual markup before script execution. Verify startup in the browser as well as testing handlers.
