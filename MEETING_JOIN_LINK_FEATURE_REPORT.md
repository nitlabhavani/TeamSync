# TeamSync AI — Meeting Join Link Feature Report

## 1. Executive Summary
The **Meeting Join Link** feature adds first-class, production-quality online meeting access to TeamSync AI. Guides and Team Leaders can now provide an online meeting join link (e.g., Google Meet, Zoom, Microsoft Teams) during meeting scheduling or add/update it later. Students enrolled in the group can view the join link and launch the meeting safely with a single click (`rel="noopener noreferrer"`), copy the link with instantaneous UI feedback, and access the link directly within the Calendar view.

Unauthorized attempts to tamper with meeting links (by regular students or external users) are strictly blocked with `403 Forbidden`. Unsafe URLs (such as `javascript:`, `data:`, `file:`, localhost, private IPs, or script tags) are sanitized and rejected with `400 Bad Request`. Existing meetings without a link continue to operate seamlessly with zero breaking changes.

---

## 2. Architecture & Design Principles

### 2.1 Backend Architecture
- **Model Layer (`Meeting.js`)**:
  - Added optional `meetingLink: { type: String, trim: true, default: null }`.
  - Enabled virtuals and automatic fallback (`meetingLink || link || null`) for complete backward compatibility with existing databases and legacy records.
- **Validation Layer (`urlValidator.js`)**:
  - Implemented `validateMeetingLink(url)`:
    - Strictly enforces `https://` protocol.
    - Explicitly checks and rejects pseudo-schemes (`javascript:`, `data:`, `file:`, `vbscript:`).
    - Rejects HTML injection, line breaks, null bytes, and control characters.
    - Validates public domain names (FQDN) with valid top-level domains.
    - Prohibits `localhost`, local domains (`.local`, `.internal`), loopback addresses (`127.0.0.1`, `::1`), and private IPv4/IPv6 networks.
- **Controller Layer (`meetingController.js`)**:
  - `create`: Inspects `req.body.meetingLink`. If supplied, verifies caller is Guide (`req.isGuide`) or Team Leader (`req.isLeader`). Non-authorized roles attempting to supply a link receive `403 Forbidden`. Validates and normalizes URL via `validateMeetingLink`.
  - `update`: Enforces that only Guides and Team Leaders can add, update, or clear `meetingLink`. Ordinary students updating meeting notes or action items proceed safely.
  - `list` & `getOne`: Return populated meetings with normalized `meetingLink` field.
- **Calendar Layer (`calendarController.js`)**:
  - Selected `meetingLink` in meeting query projection.
  - Attached `metadata.meetingLink` to each meeting event for instantaneous calendar modal display.

### 2.2 Frontend Architecture
- **Service Layer (`meetingService.js`)**:
  - Normalized `meetingLink: m.meetingLink || m.link || null` in `toMeeting`.
  - Passed `meetingLink` in `scheduleMeeting` and `updateMeeting`.
- **Meetings Page (`Meetings.jsx`)**:
  - **Schedule Form**: Added optional "Meeting link" field with helper text `"Add the online meeting link so participants can join."`. Client-side validation prevents submitting invalid non-HTTPS URLs. Form only accepts link input from authorized organizers (Guides/Leaders).
  - **Meeting Access Card**: Prominently displayed under the active meeting header:
    - *When link is present*:
      - Primary **"Join Meeting"** button opening the destination in a new tab with `target="_blank" rel="noopener noreferrer"`.
      - Secondary **"Copy link"** button with copy-to-clipboard functionality and a "Copied!" feedback state.
      - Shortened URL label for clean display (e.g. `meet.google.com/xyz-abc-def`).
      - "Edit link" option for Guides and Team Leaders.
    - *When link is not present*:
      - For Guide/Team Leader: Displays `"Meeting link not added yet. Add a meeting link so participants can join."` with an inline **"Add meeting link"** button to input and save the link immediately.
      - For Students: Displays friendly read-only notice: `"The organizer has not added a meeting link yet."`
- **Calendar Integration (`Calendar.jsx`)**:
  - In `EventDetailModal`: Displays the **Online Meeting Access** card whenever viewing a meeting event.
  - Shows shortened link, copy button, and "Join Meeting Now" button.
  - Footer provides a dedicated "Join Meeting" quick-action button next to "Go to Meetings".

---

## 3. Security & Access Control Matrix

| Action | Guide | Team Leader | Enrolled Student | Outside Student / User |
| :--- | :---: | :---: | :---: | :---: |
| **Schedule Meeting with Join Link** | Allowed (201) | Allowed (201) | Blocked (403) | Blocked (403) |
| **Schedule Meeting without Join Link** | Allowed (201) | Allowed (201) | Allowed (201) | Blocked (403) |
| **Add / Update Meeting Join Link** | Allowed (200) | Allowed (200) | Blocked (403) | Blocked (403) |
| **View Meeting Join Link** | Allowed (200) | Allowed (200) | Allowed (200) | Blocked (403) |
| **Launch Join Meeting (`target="_blank"`)** | Allowed | Allowed | Allowed | N/A |
| **Calendar View Meeting Join Link** | Allowed | Allowed | Allowed | Blocked (403) |

---

## 4. Verification & Testing Summary

### 4.1 Automated Unit & Controller Tests (`testMeetingJoinLink.js`)
- **18 out of 18 test cases passed**:
  - `validateMeetingLink` returns null for empty or omitted inputs.
  - Accepts standard Google Meet, Zoom, MS Teams, AWS Chime HTTPS URLs.
  - Rejects `http://` non-secure URLs.
  - Rejects `javascript:`, `data:`, `file:`, `vbscript:` pseudo-schemes.
  - Rejects HTML tags and script injection attempts.
  - Rejects `localhost`, private subnets (`192.168.x`, `10.x`, `172.16.x`), and IP addresses.
  - Rejects invalid domains without TLDs.
  - Guide/Leader can create meeting with HTTPS link.
  - Guide/Leader can create meeting without link (defaults to null).
  - Regular student cannot provide `meetingLink` on creation (`403 Forbidden`).
  - Regular student can schedule a meeting without a link (`201 Created`).
  - Invalid URLs on create/update return `400 Bad Request`.
  - Guide/Leader can update `meetingLink` on existing meeting.
  - Regular student cannot update `meetingLink` (`403 Forbidden`).
  - Regular student can read `meetingLink` via `list` and `getOne`.
  - Backward compatibility: legacy `link` falls back cleanly to `meetingLink`.
  - Calendar includes `meetingLink` in meeting event metadata.

### 4.2 Live End-to-End API Tests (`testMeetingJoinLinkLive.js`)
- Verified against live MongoDB and live Express server on `http://localhost:5000`:
  - Guide created meeting with Google Meet link -> `201 Created`.
  - Enrolled student read meeting -> received valid `meetingLink`.
  - Enrolled student attempted to update `meetingLink` -> returned `403 Forbidden`.
  - Guide updated `meetingLink` to Zoom link -> `200 OK`.
  - Calendar API `/groups/:groupId/calendar` returned `metadata.meetingLink` for the meeting.
  - Unsafe URL injection rejected with `400 Bad Request`.
  - Cleaned up test meeting.

### 4.3 Regression Test Suite
- `testProjectPlanTaskService.js`: 10/10 passed.
- `testAddTaskAuthorization.js`: 6/6 passed.
- `testMeetingActionItems.js`: 11/11 passed.
- `testTasksPageGroupIsolation.js`: 5/5 passed.
- Frontend build (`npm run build`): Successfully compiled with 0 errors.

---

## 5. Deliverables & File Changes

| File | Change Summary |
| :--- | :--- |
| `backend/src/models/Meeting.js` | Added `meetingLink: { type: String, trim: true, default: null }` and virtual options |
| `backend/src/utils/urlValidator.js` | Created safe HTTPS URL validator rejecting unsafe schemes, localhost, private IPs, HTML |
| `backend/src/controllers/meetingController.js` | Added role check for Guide/Leader, URL validation, and normalization |
| `backend/src/controllers/calendarController.js` | Projected `meetingLink` and attached to calendar event metadata |
| `frontend/src/services/meetingService.js` | Added `meetingLink` normalization in `toMeeting` |
| `frontend/src/pages/student/Meetings.jsx` | Added Meeting Link schedule input, validation, and Meeting Access card with Join & Copy |
| `frontend/src/pages/common/Calendar.jsx` | Added Online Meeting Access card and Join Meeting action in EventDetailModal |
| `backend/scripts/testMeetingJoinLink.js` | Comprehensive unit and controller test suite |
| `backend/scripts/testMeetingJoinLinkLive.js` | Live end-to-end API test script against running backend and MongoDB |
