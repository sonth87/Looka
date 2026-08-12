# FACE PLATFORM --- MASTER SPECIFICATION FOR AI AGENTS

> Complete implementation contract for an offline-first Electron face
> capture, face recognition, liveness, and attendance application.

## Master Principles

-   Offline recognition is mandatory for the local product path.
-   Face Registration, Face Recognition, Liveness, and Attendance are
    separate layers.
-   Unknown is a valid and safe result.
-   Embeddings are model-versioned biometric data.
-   Attendance success means local persistence succeeded; server sync is
    separate.
-   Renderer must not directly access sensitive infrastructure.
-   All expensive AI work must be isolated from UI rendering.
-   All thresholds must be configurable and benchmarked.

# 01 Product Charter

-   Purpose: build an offline-first Electron application that captures
    face samples, creates a versioned Face Profile, recognizes
    registered people, performs optional liveness verification, and
    creates attendance events.
-   Primary users: administrator/operator for registration and
    employee/user at the attendance kiosk.
-   Primary constraint: face inference and attendance persistence must
    work without Internet connectivity.
-   Product boundary: Camera, Face Engine, Face Profile, Recognition,
    Liveness, Attendance, Local Storage, Optional Sync.
-   Non-goal for MVP: cloud-only recognition, unrestricted surveillance,
    emotion analysis, demographic inference, or multi-person attendance.

# 02 Core Architecture

-   Architecture must separate Camera, Face Engine, Face Profile,
    Recognition, Attendance, Database, and Sync.
-   Renderer owns presentation and interaction only.
-   Preload exposes narrow typed APIs.
-   Main process owns protected infrastructure.
-   AI inference runs outside the UI rendering path.
-   Attendance business rules must not be embedded inside model
    adapters.
-   Model-specific code must be replaceable through interfaces.
-   All identity decisions must fail safely toward UNKNOWN.
-   Internet is optional for local recognition and attendance.

# 03 Electron

-   Use Electron with React and TypeScript.
-   Enable contextIsolation.
-   Disable renderer Node integration.
-   Expose only explicit preload APIs.
-   Do not expose arbitrary filesystem, shell, database, or
    child-process APIs to the renderer.
-   Use typed IPC channels such as camera:listDevices, face:register,
    face:recognize, attendance:checkIn.
-   Keep native modules compatible with the target Electron version.
-   Store writable application data in the user-data directory, never
    inside the packaged application bundle.
-   Keep model resources discoverable through platform-safe Electron
    resource paths.

# 04 Camera

-   Enumerate camera devices before starting a session.
-   Request camera permission explicitly.
-   Allow administrator to select a camera.
-   Support start, stop, pause, resume, and restart.
-   Detect camera disconnection.
-   Recover from temporary camera failure.
-   Stop frame processing after camera shutdown.
-   Do not keep an unbounded queue of frames.
-   Use latest-frame processing when the worker is behind.
-   Keep camera preview independent from inference FPS.
-   Target 720p or 1080p initially and benchmark against actual
    hardware.
-   Do not assume higher resolution always improves recognition.

# 05 Frame Pipeline

-   Camera FPS and AI FPS are independent.
-   Preview should normally run at the camera's native usable FPS.
-   Face detection may run at a lower rate.
-   Embedding generation should run only when useful.
-   Drop obsolete frames instead of building latency.
-   Use a bounded queue.
-   Reuse analysis results within the same frame.
-   Do not allocate large temporary buffers unnecessarily.
-   Measure frame-to-result latency.
-   Stop processing when the feature is inactive.

# 06 Face Detection

-   Detection answers whether a face exists and where it is.
-   Output must contain bounding box and detection confidence.
-   Registration MVP requires exactly one face.
-   Attendance MVP requires exactly one face.
-   Multiple faces must produce an explicit MULTIPLE_FACES state.
-   No face must never become an identity.
-   Minimum face size must be configurable.
-   Detection thresholds must be centralized in policy configuration.
-   Detection model must be hidden behind a FaceDetector interface.
-   Detector failure must be distinguishable from NO_FACE.

# 07 Face Tracking

-   Tracking is optional but recommended for smooth UX.
-   Track IDs are temporary and are not person IDs.
-   Use tracking to smooth bounding boxes and motion.
-   Invalidate a track after a configurable disappearance timeout.
-   Do not treat track persistence as identity confidence.
-   Track changes should invalidate short-lived embedding caches.
-   Tracking must not prevent a new person from being recognized.

# 08 Landmarks

-   Landmarks support alignment, pose, eye state, and quality analysis.
-   Landmark model must be replaceable.
-   Landmark confidence should be available to downstream quality logic.
-   Missing landmarks must produce a typed analysis failure.
-   Do not couple domain code to a fixed landmark count.
-   Landmark coordinates must use a documented coordinate system.

# 09 Face Alignment

-   Registration and recognition must use the same preprocessing
    pipeline for a given model version.
-   Alignment must be deterministic.
-   Document crop size, padding, rotation, scale, color order, and
    normalization.
-   Do not compare embeddings produced from incompatible preprocessing.
-   Keep alignment behind an interface.
-   Alignment failures must prevent unsafe recognition.

# 10 Head Pose

-   Use yaw, pitch, and roll as the primary pose representation.
-   Document the sign convention.
-   Verify left/right behavior against mirrored preview on real
    hardware.
-   Pose values should be smoothed before guidance.
-   Registration tasks define target pose and tolerance.
-   Capture is allowed only when every required axis is inside
    tolerance.
-   Use hysteresis to prevent instruction flicker.
-   Do not substitute simple bounding-box rotation for true pose without
    validation.

# 11 Face Quality

-   Quality is a gate before registration capture.
-   Quality is also a gate before recognition.
-   Quality dimensions may include face size, sharpness, brightness,
    contrast, occlusion, pose, eye state, and stability.
-   Return both an overall score and structured failure reasons.
-   Quality policy must be configurable per workflow.
-   Registration can require stricter quality than attendance
    recognition.
-   Normal UX should show one dominant corrective message rather than
    raw scores.

# 12 Blur

-   Use a deterministic sharpness or blur metric.
-   Expose normalized sharpness rather than the implementation-specific
    algorithm.
-   Reject severe blur.
-   Do not over-reject mild motion if recognition remains reliable.
-   Benchmark thresholds on target cameras.
-   Show HOLD_STILL or MOVE_CAREFULLY when blur is caused by motion.

# 13 Lighting

-   Detect severe underexposure.
-   Detect severe overexposure.
-   Detect problematic backlighting where practical.
-   Do not reject minor lighting variation unnecessarily.
-   Guide the user toward better light.
-   Do not expose numeric brightness values in normal kiosk UI.

# 14 Occlusion

-   Define which facial regions must be visible.
-   Eyes should normally be visible for robust capture.
-   Document policy for masks, glasses, hats, hair, and hands.
-   Do not silently change occlusion rules between registration and
    recognition.
-   Return OCCLUDED as a structured quality reason.

# 15 Registration Product

-   Registration creates a reusable Face Profile for a known Person.
-   Registration is not recognition.
-   Registration must start with a selected person.
-   Existing profiles must not be overwritten silently.
-   Registration should be a guided, automatic capture workflow.
-   Required default poses are FRONT, LEFT, RIGHT, UP, DOWN.
-   Each task is configurable.
-   Each task has target pose, tolerance, stability duration, countdown,
    and quality policy.
-   Profile becomes ACTIVE only after all required tasks succeed.

# 16 Registration State Machine

-   Use explicit states: IDLE, INITIALIZING, WAITING_FOR_FACE,
    MULTIPLE_FACE, FACE_FOUND, GUIDING, POSE_REACHED, STABILIZING,
    VALIDATING, COUNTDOWN, CAPTURING, REVIEWING, RETRYING, COMPLETED,
    FAILED.
-   Transitions must be triggered by typed events.
-   Guards must be explicit.
-   Side effects must be centralized.
-   Do not model workflow using a collection of unrelated React
    booleans.
-   State must survive UI rerendering.
-   Cancellation must return to a safe state.
-   Timeouts must be handled explicitly.

# 17 Registration Guidance

-   Guidance must answer what the user should do next.
-   Examples: Look straight, Turn left, Turn right, Look up, Look down,
    Move closer, Move farther, Hold still, Improve lighting.
-   Guidance direction must be calibrated with the mirrored preview.
-   Use hysteresis to prevent left/right flicker.
-   Prioritize the most actionable problem.
-   Do not display yaw/pitch/roll in normal UX.
-   Allow optional audio guidance.
-   All guidance strings must be localized.

# 18 Registration Stability

-   Do not capture immediately when pose first enters tolerance.
-   Require pose to remain valid for a configured stability interval.
-   Track face position and size movement as part of stability.
-   If pose exits tolerance, restart stability.
-   Show a subtle progress indicator during stabilization.
-   Capture only after stability and quality both pass.
-   Do not let a single transient frame trigger capture.

# 19 Registration Auto Capture

-   Automatic capture is the preferred kiosk UX.
-   Capture occurs after pose, stability, quality, face count, and
    face-size requirements pass.
-   Optional countdown can provide visual confirmation.
-   After capture, validate the actual captured frame again.
-   If validation fails, do not advance to the next task.
-   Retry returns to the guidance state.
-   Do not make users press a shutter button unless a deployment
    specifically requires it.

# 19A Capture Trigger Mode

-   The system must support three configurable capture trigger modes:
    AUTO, MANUAL, and OFF.
-   Capture trigger mode must be configurable per workflow and per
    deployment profile.
-   The active trigger mode must be persisted across sessions.

## AUTO mode

-   AUTO is the default mode for unattended kiosk deployments.
-   Capture fires automatically after pose, quality, and stability
    requirements are met for a configured duration.
-   Auto-capture stability duration must be configurable, default 2
    seconds.
-   A progress indicator must be shown during the stability hold period.
-   If the face exits pose tolerance before the stability duration
    completes, the timer must reset.
-   The stability duration must be long enough to prevent accidental
    captures but short enough not to frustrate legitimate users.

## MANUAL (Hand Gesture) mode

-   MANUAL mode replaces automatic timer capture with a deliberate user
    gesture.
-   Pose, quality, and face presence requirements still apply before a
    gesture is accepted.
-   Supported default gestures: VICTORY (V sign), THUMBS_UP, OPEN_PALM,
    CLOSED_FIST, OK_SIGN.
-   The system must display a visual indicator of the recognized gesture
    in real time.
-   A recognized trigger gesture must be held for a short confirmation
    window (default 500 ms) before capture fires, to prevent accidental
    activation.
-   Only one trigger gesture per workflow step is required.
-   The set of accepted trigger gestures must be configurable.
-   Unrecognized gestures must not interfere with face detection or
    quality evaluation.
-   Gesture recognition must not add perceptible latency to the face
    pipeline.
-   Gesture recognition runs as a parallel inference path, not a
    blocking step in the face pipeline.

## OFF mode

-   OFF mode replaces automatic and gesture capture with an explicit
    shutter button visible in the UI.
-   The shutter button must be enabled only when pose, quality, and face
    presence requirements are met.
-   The shutter button must clearly communicate its enabled or disabled
    state.
-   OFF mode is appropriate for accessibility scenarios or operator-led
    registration.

# 19B Hand Gesture Recognition

-   Hand gesture recognition uses MediaPipe Hand Landmarker as the
    primary adapter.
-   Hand Landmarker must be initialized alongside the Face Landmarker
    when MANUAL mode is active.
-   Hand Landmarker must be shut down or paused when MANUAL mode is
    inactive to preserve performance.
-   The adapter must expose a GestureEngine interface to the workflow,
    decoupled from the MediaPipe API.
-   Supported gesture classifiers: VICTORY, THUMBS_UP, OPEN_PALM,
    CLOSED_FIST, OK_SIGN, NONE.
-   Gesture classification must be derived from 21 hand landmarks per
    hand.
-   Multi-hand detection should prefer the dominant hand for trigger
    evaluation if one hand is consistently visible.
-   Gesture confidence score must be above a configurable threshold
    before a gesture is reported.
-   Gesture output must be smoothed to prevent flickering between
    adjacent gesture classes.
-   The gesture engine must emit a typed GestureState event for each
    processed frame.
-   Gesture inference may run on the same FramePipeline or a separate
    pipeline at a lower FPS to reduce CPU usage.
-   Recommended gesture inference rate is 10–15 FPS.
-   Gesture classification logic must be testable without a camera.
-   The GestureEngine interface must be replaceable with alternative
    classifiers.
-   Gesture UI must show the active gesture name and a capture-ready
    visual feedback overlay.

# 20 Registration Samples

-   Each task may produce several candidate frames.
-   Score candidate frames.
-   Keep the best frame or a small number of best frames.
-   Do not store every transient camera frame.
-   Raw samples are temporary by default.
-   Retain raw images only if the product explicitly requires them.
-   Temporary sample cleanup must happen after profile creation or
    cancellation.

# 21 Registration Review

-   Optional review shows the captured image, task name, quality state,
    and Retake/Accept actions.
-   Automatic mode may skip manual review.
-   Manual review must never allow a capture that failed mandatory
    validation.
-   Review should not expose internal model numbers to ordinary users.

# 22 Registration Profile Build

-   After all tasks pass, align accepted samples.
-   Generate embeddings using the active model.
-   Store model family and model version.
-   Store embedding dimension and preprocessing version.
-   Build the Face Profile transactionally.
-   Do not activate a profile if any required embedding failed.
-   Profile creation must be atomic.
-   Recognition index must refresh after successful activation.

# 23 Face Profile

-   A Person can have one active Face Profile.
-   A Face Profile can contain multiple embeddings.
-   Each embedding belongs to a pose/sample.
-   Profile status may be DRAFT, ACTIVE, DISABLED, REPLACED.
-   Profile version should be tracked.
-   Disabled profiles must not enter the recognition index.
-   Profile deletion does not necessarily mean historical attendance
    deletion.

# 24 Face Embedding

-   Embedding converts an aligned face into a numerical identity
    representation.
-   Store embeddings as binary numeric data where practical.
-   Record vector dimension.
-   Record model family.
-   Record model version.
-   Record preprocessing version.
-   Record similarity metric.
-   Do not compare embeddings from incompatible models.
-   Normalize vectors according to the model contract.
-   Keep the embedding implementation behind FaceEmbedder.

# 25 Recognition

-   Recognition answers which registered identity best matches the
    observed face.
-   Recognition pipeline: detect, quality, liveness, align, embed,
    search, score, threshold, temporal confirmation.
-   Unknown is a valid result.
-   Nearest neighbor without threshold is not sufficient.
-   Use configurable similarity threshold.
-   Optionally use a best-vs-second-best margin.
-   Use multiple observations where practical.
-   Recognition must never directly create attendance without business
    validation.

# 26 Similarity Search

-   For small datasets, brute-force in-memory comparison is acceptable.
-   Load active compatible embeddings into a recognition index.
-   Use typed arrays for efficient numeric comparison.
-   Return Top-K candidates.
-   Filter inactive profiles before indexing.
-   Rebuild the index when profiles change.
-   Atomically swap the new index.
-   For large datasets, benchmark before introducing a vector index.
-   Do not prematurely introduce a remote vector database.

# 27 Recognition Threshold

-   Threshold must be calibrated from representative genuine and
    impostor pairs.
-   Do not choose a threshold only because a model README suggests one.
-   Measure false acceptance and false rejection.
-   Attendance should prioritize avoiding false identity attribution.
-   Threshold must be versioned in policy configuration.
-   Changing threshold should be auditable in controlled deployments.

# 28 Recognition Temporal Policy

-   Do not rely on a single frame when multiple frames are available.
-   Possible policies: N consecutive matches or M-of-N voting.
-   Identity should stabilize before attendance commit.
-   Outlier results should not immediately replace a stable identity.
-   When the face disappears, expire the identity lock.
-   Temporal policy must be configurable and tested.

# 29 Ambiguity

-   If the best and second-best scores are too close, treat the result
    as ambiguous.
-   Do not reveal candidate names to the user.
-   Return UNKNOWN or AMBIGUOUS according to policy.
-   Ambiguity is safer than forced attribution.
-   Benchmark margin policy before enabling it in production.

# 30 Liveness

-   Liveness is separate from identity recognition.
-   It answers whether the observed presentation appears to be a live
    person.
-   Threats include printed photos, phone photos, replayed video, and
    screen presentations.
-   Passive liveness is lower friction.
-   Active liveness can require user actions.
-   Registration may require stronger liveness than ordinary attendance.
-   Attendance liveness policy must be explicit.
-   Liveness must be benchmarked against the actual deployment threat
    model.

# 31 Active Liveness

-   Possible challenges: turn left, turn right, look up, blink.
-   Challenges should be generated after the session starts.
-   Randomized challenges can reduce simple replay attacks.
-   Do not use a fixed visible sequence for high-security environments.
-   Active liveness adds UX friction.
-   Challenge state must be a state machine.
-   Failure should return to a retryable state.

# 32 Passive Liveness

-   Passive liveness can run continuously.
-   It should not block ordinary interaction unnecessarily.
-   Model-specific thresholds must be calibrated.
-   Passive liveness alone may be insufficient for high-risk
    environments.
-   Deployment risk determines whether active liveness is required.

# 33 Attendance Product

-   Attendance consumes a verified identity and creates a business
    event.
-   Attendance is not part of the AI model.
-   Attendance checks employee status and business rules.
-   Attendance is persisted locally.
-   Network synchronization is optional for the transaction.
-   Attendance success means local persistence succeeded.
-   Sync success is a separate status.

# 34 Attendance State Machine

-   States: READY, SEARCHING, VERIFYING, MATCHED, ATTENDANCE_VALIDATING,
    SUCCESS, ALREADY_RECORDED, UNKNOWN, ERROR.
-   Recognition and attendance states should remain distinguishable.
-   Database commit must occur before SUCCESS.
-   After success, return to READY after a short display interval.
-   Face disappearance should reset recognition state.
-   Cooldown should prevent duplicate events.

# 35 Attendance Business Rules

-   Check whether Person is active.
-   Check whether attendance mode allows the event.
-   Check duplicate policy.
-   Check cooldown.
-   Check shift or schedule if required.
-   Check device policy if required.
-   Do not encode these rules inside the face model adapter.
-   Keep policies configurable and testable.

# 36 Duplicate Attendance

-   Prevent repeated check-ins from continuous recognition.
-   Use cooldown and/or business-day/shift uniqueness.
-   Make duplicate detection deterministic.
-   Do not create a new event every frame.
-   Server must also be idempotent when sync is enabled.

# 37 Attendance Timestamp

-   Use timezone-aware timestamps.
-   Store device time.
-   If online, optionally store server receipt time.
-   Detect significant clock drift.
-   Do not silently rewrite historical timestamps.
-   Define the business timezone explicitly.

# 38 Offline Architecture

-   Camera works locally.
-   Face detection works locally.
-   Embedding works locally.
-   Recognition works locally.
-   Liveness works locally.
-   Attendance persistence works locally.
-   Network is used only for optional synchronization and centralized
    management.
-   Network failure must not disable the local face engine.

# 39 SQLite

-   Use SQLite for local persistence.
-   Version schema with migrations.
-   Use transactions for attendance.
-   Index person IDs, profile IDs, timestamps, and sync state.
-   Keep database access outside React.
-   Use parameterized queries.
-   Do not expose generic SQL through IPC.
-   Back up data if the deployment requires business continuity.

# 40 Database Tables

-   persons: identity and employee metadata.
-   face_profiles: profile lifecycle and model metadata.
-   face_embeddings: numeric vectors and pose metadata.
-   face_samples: optional retained raw sample references.
-   attendance_records: local attendance events.
-   attendance_sessions: kiosk recognition sessions.
-   sync_queue: pending server operations.
-   model_versions: installed model metadata.
-   devices: device identity and configuration.
-   app_settings: versioned configuration.
-   audit_events: administrative/security events.

# 41 Attendance Transaction

-   Use one local transaction for attendance insertion and sync queue
    insertion.
-   Commit both or neither.
-   Do not show attendance success before commit.
-   On rollback, show an actionable error.
-   On restart, pending sync records remain available.

# 42 Sync Queue

-   Each sync item has stable ID, entity type, operation, payload, retry
    count, status, and timestamps.
-   Use PENDING, PROCESSING, FAILED, SYNCED states.
-   After crash, stale PROCESSING items return to PENDING.
-   Use exponential backoff.
-   Cap retry intervals.
-   Do not block face recognition while syncing.

# 43 Sync Idempotency

-   Every attendance event has an immutable event ID.
-   Server treats repeated event IDs as the same event.
-   Client safely retries timeouts.
-   ACK must be recorded locally.
-   Do not delete a queue item before confirmed server acceptance.

# 44 Profile Sync

-   If central management exists, profiles may flow server to device.
-   Profile versions must be explicit.
-   Download new compatible profiles before activation.
-   Build a new recognition index before swapping.
-   Do not leave the device with a partially updated index.
-   Raw images should not be distributed unless required.

# 45 Model Management

-   Models are versioned assets.
-   Model metadata includes family, version, dimension, preprocessing,
    and metric.
-   Validate model checksum or equivalent integrity information.
-   Warm up models before marking them ready.
-   Do not activate an incompatible model.
-   Keep rollback capability when updating models.
-   Verify redistribution and commercial-use licensing.

# 46 Model Packaging

-   Models can be bundled for true offline-first behavior.
-   Models can also be provisioned during installation if the product
    allows it.
-   Production should not silently download models at first use unless
    that behavior is explicitly designed.
-   Resolve model paths using Electron resource paths.
-   Do not assume the development filesystem layout equals packaged
    layout.

# 47 Model Migration

-   Old and new embedding spaces may be incompatible.
-   Changing embedding model normally requires re-encoding samples or
    re-registration.
-   Never compare old and new embeddings unless compatibility is proven.
-   Store model version with every embedding.
-   Support a controlled migration or re-registration strategy.

# 48 Security

-   Treat face embeddings as sensitive biometric data.
-   Protect database and raw samples.
-   Keep secrets out of renderer bundles.
-   Use OS secure storage for device secrets where applicable.
-   Use TLS for server sync.
-   Restrict administrative operations.
-   Audit profile creation, deletion, configuration changes, and device
    changes.
-   Do not log raw face images or embeddings by default.

# 49 Privacy

-   Define purpose for face collection.
-   Define retention period.
-   Define deletion process.
-   Define who can access face profiles.
-   Minimize raw image retention.
-   Do not collect unrelated biometric attributes.
-   Provide deployment-specific consent/legal controls where required.

# 50 UI Registration

-   Show person identity and current step.
-   Show camera preview.
-   Show face guide.
-   Show one dominant instruction.
-   Show progress such as Front, Left, Right, Up, Down.
-   Use clear success state.
-   Provide retry.
-   Provide cancel.
-   Do not show raw model scores to ordinary users.

# 51 UI Recognition

-   Show camera preview.
-   Show subtle face guide.
-   Show searching/verification state.
-   Show success with person name only if the deployment permits it.
-   Show attendance result.
-   Show unknown without revealing nearest candidate.
-   Keep interaction button-free when kiosk mode is desired.

# 52 UI Diagnostics

-   Admin diagnostics should show camera, AI, database, sync, and system
    health.
-   Show model versions.
-   Show processing latency.
-   Show FPS.
-   Show device and camera identifiers.
-   Do not expose raw embeddings.
-   Allow export of privacy-safe support diagnostics.

# 53 UX Guidance

-   Every recoverable condition needs a human action.
-   Use MOVE_CLOSER when face is too small.
-   Use MOVE_FARTHER when face is too large.
-   Use TURN_LEFT or TURN_RIGHT for yaw error.
-   Use LOOK_UP or LOOK_DOWN for pitch error.
-   Use HOLD_STILL during stabilization.
-   Use IMPROVE_LIGHT for severe illumination problems.
-   Use SINGLE_FACE for multiple-face state.

# 54 UX Hysteresis

-   Pose guidance must not flip rapidly.
-   Quality guidance must not flip rapidly.
-   Use a dead zone around target pose.
-   Use separate enter and exit tolerances where useful.
-   Smooth numeric inputs before converting them to language.
-   Prioritize actionable guidance.

# 55 Accessibility

-   Use sufficient contrast.
-   Do not communicate status only through color.
-   Provide keyboard access in admin screens.
-   Use readable text.
-   Provide optional audio guidance.
-   Keep touch targets large for kiosk use.
-   Externalize all user-facing strings for localization.

# 56 Error Handling

-   Use typed error codes.
-   Distinguish user-correctable errors from system errors.
-   Never expose stack traces to ordinary users.
-   Every user-correctable error should offer a next action.
-   Camera errors should offer retry or settings.
-   Model errors should be visible to administrators.
-   Database errors must prevent false success.

# 57 Logging

-   Log subsystem, event type, result, duration, model version, and
    error code.
-   Do not log raw frames by default.
-   Do not log embeddings by default.
-   Use log levels.
-   Keep logs bounded and rotated.
-   Allow admin diagnostics without exposing biometric payloads.

# 58 Performance

-   Do not run expensive inference on every frame.
-   Use staged processing.
-   Run detection more frequently than embedding.
-   Warm models.
-   Reuse model instances.
-   Use worker threads/processes where appropriate.
-   Measure CPU, GPU, RAM, FPS, and latency.
-   Run long-duration stability tests.

# 59 Testing

-   Unit-test pose tolerance.
-   Unit-test guidance.
-   Unit-test state transitions.
-   Unit-test quality policy.
-   Unit-test threshold decisions.
-   Unit-test attendance rules.
-   Unit-test duplicate prevention.
-   Unit-test sync retries.
-   Integration-test camera lifecycle.
-   Integration-test database transactions.
-   AI accuracy must be tested on representative genuine and impostor
    samples.

# 60 Security Testing

-   Test photo attacks.
-   Test replay attacks where relevant.
-   Test renderer IPC abuse.
-   Test unauthorized profile access.
-   Test secret leakage.
-   Test database file access assumptions.
-   Test model tampering detection.
-   Test device revocation if central management exists.

# 61 Performance Testing

-   Benchmark cold model startup.
-   Benchmark warm inference.
-   Benchmark detection latency.
-   Benchmark embedding latency.
-   Benchmark liveness latency.
-   Benchmark total verification latency.
-   Run 8-hour or longer kiosk stability tests.
-   Measure memory growth.
-   Measure queue behavior under slow inference.

# 62 Edge Cases

-   No camera.
-   Permission denied.
-   Camera disconnect.
-   Camera reconnect.
-   No face.
-   Multiple faces.
-   Face too small.
-   Face too large.
-   Blur.
-   Darkness.
-   Backlight.
-   Occlusion.
-   Wrong pose.
-   Rapid movement.
-   Unknown identity.
-   Ambiguous identity.
-   Liveness failure.
-   Model failure.
-   Database failure.
-   Disk full.
-   Network unavailable.
-   Server timeout.
-   Duplicate sync.
-   Clock drift.
-   App crash during registration.
-   App crash after attendance commit.

# 63 Device Modes

-   ADMIN mode manages people and profiles.
-   OPERATOR mode assists registration and support.
-   KIOSK mode performs recognition and attendance.
-   Each mode exposes only necessary capabilities.
-   Kiosk should not expose database controls.
-   Admin actions should be authenticated and auditable.

# 64 Device Identity

-   Each installation should have a stable device UUID.
-   Store device configuration separately from biometric profiles.
-   If a server exists, support device enrollment.
-   Support device revocation where required.
-   Do not use precise hardware identifiers unless necessary.

# 65 Kiosk Mode

-   Fullscreen is optional.
-   Camera should start automatically when the kiosk screen is ready.
-   Controls should be minimal.
-   User should not need a keyboard.
-   After success, return automatically to READY.
-   Failures should be recoverable without restarting the app.

# 66 Recognition 1:N

-   Attendance normally uses one-to-many recognition.
-   Query embedding is compared against active compatible profiles.
-   Top-K results are passed to policy.
-   Threshold decides match versus unknown.
-   Optional margin decides ambiguity.
-   Temporal policy stabilizes the result.

# 67 Verification 1:1

-   Future identity verification can use claimed person ID plus face.
-   Only that person's embeddings are searched.
-   1:1 verification is distinct from 1:N recognition.
-   Keep both APIs available at the service boundary.

# 68 Future Access Control

-   Face Engine must not directly open doors.
-   Recognition produces identity.
-   Authorization decides permission.
-   Access controller performs the physical action.
-   Audit all access decisions.

# 69 Future Server

-   Central server is optional.
-   Server may manage people, profiles, devices, configuration, and
    attendance.
-   Device remains operational offline.
-   Server communication is authenticated.
-   Attendance events are idempotent.
-   Profile updates are versioned and atomically applied.

# 70 Deployment

-   Test Windows and macOS separately if both are targets.
-   Validate camera permissions.
-   Validate native module ABI.
-   Validate model packaging.
-   Validate writable data paths.
-   Validate app updates preserve SQLite.
-   Validate model updates and rollback.
-   Validate installer behavior on clean machines.

# 71 Data Retention

-   Define how long attendance is retained.
-   Define how long raw samples are retained if any.
-   Define when disabled profiles are deleted.
-   Define backup retention.
-   Document deletion semantics.
-   Keep historical attendance independent from active face profile
    lifecycle unless business policy says otherwise.

# 72 Operational Runbook

-   Startup check: database, model, camera.
-   Daily check: device health and pending sync.
-   Failure check: camera, model, database, network.
-   Recovery: restart camera, restart face worker, retry sync.
-   Escalation: admin diagnostics and support bundle.
-   Do not ask kiosk users to edit files manually.

# 73 AI Agent Implementation Rules

-   Inspect the existing repository before changing architecture.
-   Reuse existing abstractions when sound.
-   Do not create duplicate camera or database layers.
-   Implement interfaces before model-specific code.
-   Use mocks for workflow tests.
-   Keep business rules deterministic.
-   Document architectural decisions.
-   Do not silently relax security controls.
-   Do not commit real biometric data.
-   Do not invent a cloud dependency.

# 74 Definition of Done

-   Camera lifecycle works.
-   Registration state machine works.
-   All required poses can be captured.
-   Quality gates work.
-   Embeddings are generated and versioned.
-   Profiles persist locally.
-   Recognition returns known or unknown safely.
-   Liveness policy works where enabled.
-   Attendance is transactionally persisted.
-   Offline operation works.
-   Sync is idempotent where enabled.
-   Security boundaries are tested.
-   Performance is benchmarked.
-   Packaging is tested on target hardware.
-   Documentation and ADRs are updated.

# 75 Reference Type Contracts

``` ts
interface CameraDevice {
  id: string;
  label: string;
}

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FaceDetection {
  boundingBox: BoundingBox;
  confidence: number;
}

interface FacePose {
  yaw: number;
  pitch: number;
  roll: number;
}

interface FaceQualityResult {
  overallScore: number;
  accepted: boolean;
  reasons: string[];
}

interface FaceEmbedding {
  vector: Float32Array;
  dimension: number;
  modelFamily: string;
  modelVersion: string;
  preprocessingVersion: string;
}

interface LivenessResult {
  isLive: boolean;
  score: number;
  modelVersion: string;
}

interface RecognitionCandidate {
  personId: string;
  score: number;
}

interface RecognitionResult {
  status: 'MATCH' | 'UNKNOWN' | 'NO_FACE' | 'LOW_QUALITY' | 'LIVENESS_FAILED' | 'AMBIGUOUS';
  personId?: string;
  score?: number;
  candidates?: RecognitionCandidate[];
  modelVersion: string;
}

interface AttendanceResult {
  status: 'RECORDED' | 'ALREADY_RECORDED' | 'REJECTED' | 'ERROR';
  attendanceId?: string;
  personId?: string;
}

interface FaceDetector {
  initialize(): Promise<void>;
  detect(frame: FrameInput): Promise<FaceDetection[]>;
}

interface FaceEmbedder {
  initialize(): Promise<void>;
  embed(face: AlignedFace): Promise<FaceEmbedding>;
}

interface LivenessDetector {
  initialize(): Promise<void>;
  evaluate(input: LivenessInput): Promise<LivenessResult>;
}

interface FaceEngine {
  analyze(frame: FrameInput): Promise<FaceAnalysis>;
  embed(face: AlignedFace): Promise<FaceEmbedding>;
  liveness(input: LivenessInput): Promise<LivenessResult>;
}

interface FaceRegistrationService {
  start(personId: string): Promise<RegistrationSession>;
  cancel(sessionId: string): Promise<void>;
  acceptCapture(sessionId: string): Promise<void>;
  retry(sessionId: string): Promise<void>;
  complete(sessionId: string): Promise<FaceProfile>;
}

interface FaceRecognitionService {
  recognize(request: RecognitionRequest): Promise<RecognitionResult>;
}

interface AttendanceService {
  checkIn(request: CheckInRequest): Promise<AttendanceResult>;
}
```

# 76 Database Contract

``` text
persons
  id
  employee_code
  display_name
  status
  created_at
  updated_at

face_profiles
  id
  person_id
  profile_version
  status
  model_family
  model_version
  preprocessing_version
  created_at
  updated_at

face_embeddings
  id
  face_profile_id
  vector_blob
  dimension
  pose_yaw
  pose_pitch
  pose_roll
  quality_score
  model_family
  model_version
  preprocessing_version
  created_at

face_samples
  id
  face_profile_id
  task_type
  image_path
  quality_score
  created_at

attendance_sessions
  id
  device_id
  mode
  started_at
  ended_at
  status

attendance_records
  id
  person_id
  attendance_session_id
  timestamp
  type
  identity_score
  liveness_score
  quality_score
  model_version
  policy_version
  device_id
  sync_status
  created_at

sync_queue
  id
  entity_type
  entity_id
  operation
  payload
  status
  retry_count
  next_retry_at
  created_at

model_versions
  id
  family
  version
  checksum
  status
  installed_at

devices
  id
  name
  location_id
  mode
  config_version
  status
  created_at

app_settings
  key
  value
  version

audit_events
  id
  type
  entity_type
  entity_id
  actor_id
  timestamp
  metadata
```

# 77 Registration Flow Contract

``` text
START
  ↓
LOAD PERSON
  ↓
CHECK EXISTING PROFILE
  ↓
OPEN CAMERA
  ↓
LOAD FACE MODELS
  ↓
WAIT FOR EXACTLY ONE FACE
  ↓
TASK FRONT
  ↓
POSE VALID
  ↓
STABLE
  ↓
QUALITY VALID
  ↓
CAPTURE
  ↓
TASK LEFT
  ↓
POSE VALID
  ↓
STABLE
  ↓
QUALITY VALID
  ↓
CAPTURE
  ↓
TASK RIGHT
  ↓
POSE VALID
  ↓
STABLE
  ↓
QUALITY VALID
  ↓
CAPTURE
  ↓
TASK UP
  ↓
POSE VALID
  ↓
STABLE
  ↓
QUALITY VALID
  ↓
CAPTURE
  ↓
TASK DOWN
  ↓
POSE VALID
  ↓
STABLE
  ↓
QUALITY VALID
  ↓
CAPTURE
  ↓
QUALITY SUMMARY
  ↓
ALIGN
  ↓
EMBED
  ↓
CREATE PROFILE
  ↓
ACTIVATE PROFILE
  ↓
REFRESH RECOGNITION INDEX
  ↓
DONE
```

# 78 Recognition Flow Contract

``` text
CAMERA READY
  ↓
FRAME
  ↓
DETECT
  ↓
EXACTLY ONE FACE?
  ├── NO FACE → SEARCHING
  ├── MULTIPLE → USER GUIDANCE
  └── YES
        ↓
QUALITY
        ↓
QUALITY PASS?
  ├── NO → GUIDANCE
  └── YES
        ↓
LIVENESS
        ↓
LIVE?
  ├── NO → RETRY
  └── YES
        ↓
ALIGN
        ↓
EMBED
        ↓
SEARCH
        ↓
THRESHOLD
        ↓
TEMPORAL CONFIRMATION
        ↓
MATCH / UNKNOWN / AMBIGUOUS
```

# 79 Attendance Flow Contract

``` text
MATCHED PERSON
  ↓
CHECK PERSON ACTIVE
  ↓
CHECK DEVICE POLICY
  ↓
CHECK SHIFT POLICY
  ↓
CHECK DUPLICATE
  ↓
CHECK COOLDOWN
  ↓
BEGIN TRANSACTION
  ├── INSERT ATTENDANCE
  └── INSERT SYNC QUEUE ITEM
  ↓
COMMIT
  ↓
SUCCESS
```

# 80 Failure Matrix

  -----------------------------------------------------------------------
  Failure           User state        System action     Retry
  ----------------- ----------------- ----------------- -----------------
  No camera         Camera            stop inference    yes
                    unavailable                         

  Permission denied Camera            show              yes
                    unavailable       settings/help     

  Multiple faces    Multiple people   wait              yes

  No face           Searching         continue          yes

  Face too small    Move closer       continue          yes

  Face too large    Move farther      continue          yes

  Bad pose          Guidance          continue          yes

  Blur              Hold still        continue          yes

  Low light         Improve light     continue          yes

  Liveness fail     Verification      reset session     yes
                    failed                              

  Unknown           Unable to         reset after       yes
                    identify          timeout           

  Ambiguous         Unable to         reset             yes
                    identify                            

  Model unavailable Recognition       admin error       after repair
                    unavailable                         

  Database failure  Attendance        do not claim      after repair
                    unavailable       success           

  Network           Offline           save locally      automatic sync
  unavailable                                           

  Server timeout    Offline/sync      queue remains     yes
                    pending                             

  Disk full         Persistence       do not claim      after repair
                    failure           success           
  -----------------------------------------------------------------------

# 81 Security Failure Matrix

  Threat               Detection                                Mitigation
  -------------------- ---------------------------------------- -----------------
  Printed photo        liveness                                 reject
  Phone photo          liveness                                 reject
  Replay video         active/random challenge where required   reject
  Copied database      encryption/access control                protect
  Renderer IPC abuse   allow-listed channels                    reject
  Malicious model      checksum/signature validation            reject
  Stolen device        disk encryption/device revocation        contain
  Credential leak      secure storage                           rotate
  False positive       threshold + temporal policy              fail to unknown
  Admin misuse         authorization + audit                    investigate

# 82 Performance Budget Template

The project must measure these on target hardware rather than assuming
universal values.

``` text
Camera preview FPS:                ______
Detection FPS:                     ______
Embedding FPS:                     ______
Liveness FPS:                      ______
Cold model startup:                ______ ms
Warm detection latency:            ______ ms
Warm embedding latency:            ______ ms
Warm liveness latency:             ______ ms
End-to-end verification:           ______ ms
Renderer CPU:                      ______ %
Face worker CPU:                   ______ %
Peak RAM:                          ______ MB
Long-run RAM growth:               ______ MB/hour
```

# 83 Recognition Evaluation Template

``` text
Dataset size:
Number of identities:
Genuine pairs:
Impostor pairs:
Camera:
Lighting conditions:
Distance range:
Pose range:
Model:
Model version:
Embedding dimension:
Similarity metric:
Threshold:
Margin:
Temporal policy:

False Acceptance Rate:
False Rejection Rate:
Precision:
Recall:
Median latency:
P95 latency:
```

# 84 Registration Evaluation Template

``` text
Average registration duration:
Average retry count:
Front success rate:
Left success rate:
Right success rate:
Up success rate:
Down success rate:
Average quality score:
Embedding generation failure rate:
Profile creation failure rate:
```

# 85 Release Checklist

``` text
[ ] Model license reviewed
[ ] Dependency licenses reviewed
[ ] Camera tested on target devices
[ ] Windows tested if supported
[ ] macOS tested if supported
[ ] Offline recognition tested
[ ] Offline attendance tested
[ ] App restart tested
[ ] Camera disconnect tested
[ ] Database migration tested
[ ] Model migration tested
[ ] Sync idempotency tested
[ ] Photo spoof test completed
[ ] Replay test completed if required
[ ] Threshold benchmark completed
[ ] False-positive analysis completed
[ ] False-negative analysis completed
[ ] IPC security reviewed
[ ] Secret storage reviewed
[ ] Logging reviewed
[ ] Privacy policy reviewed
[ ] Data retention reviewed
[ ] Backup/restore tested
[ ] Installer tested
[ ] Update tested
[ ] Rollback tested
[ ] Long-run test completed
[ ] Admin diagnostics tested
[ ] Kiosk UX tested
[ ] Localization reviewed
```

# 86 Suggested ADR Files

``` text
docs/decisions/
  ADR-001-electron-face-architecture.md
  ADR-002-camera-frame-pipeline.md
  ADR-003-face-model-selection.md
  ADR-004-embedding-storage.md
  ADR-005-recognition-threshold.md
  ADR-006-liveness-policy.md
  ADR-007-local-attendance.md
  ADR-008-offline-sync.md
  ADR-009-biometric-retention.md
  ADR-010-model-migration.md
  ADR-011-electron-security.md
  ADR-012-recognition-index.md
```

# 87 Suggested Project Layout

``` text
apps/
  desktop/
    src/
      main/
        ipc/
        database/
        storage/
        sync/
        device/
      preload/
      renderer/
        features/
          face-registration/
          face-recognition/
          attendance/
          admin/
        components/
        pages/
      workers/
        face-worker/
      shared/

packages/
  face-engine/
  face-domain/
  camera/
  database/
  attendance/
  sync/
  model-runtime/
```

# 88 Coding Agent Execution Plan

## Sprint 1

-   inspect repository;
-   define boundaries;
-   add types;
-   add dependency injection;
-   add database migrations;
-   add mock Face Engine.

## Sprint 2

-   implement camera lifecycle;
-   implement preview;
-   implement frame sampling;
-   implement detector adapter.

## Sprint 3

-   implement landmarks;
-   implement pose;
-   implement quality;
-   implement guidance;
-   implement registration state machine.

## Sprint 4

-   implement capture;
-   implement embedding;
-   implement Face Profile;
-   implement recognition index.

## Sprint 5

-   implement recognition;
-   implement threshold policy;
-   implement temporal confirmation;
-   implement unknown/ambiguous states.

## Sprint 6

-   implement liveness;
-   implement attendance;
-   implement duplicate prevention;
-   implement offline transactions.

## Sprint 7

-   implement sync;
-   implement device management;
-   implement diagnostics.

## Sprint 8

-   benchmark;
-   security hardening;
-   packaging;
-   long-running tests;
-   pilot deployment.

# 89 Final Agent Rules

1.  Do not collapse Face Engine and Attendance into one service.
2.  Do not let React call models directly.
3.  Do not let React call SQLite directly.
4.  Do not expose arbitrary IPC.
5.  Do not assume nearest candidate is correct.
6.  Do not lower thresholds to make demos look better.
7.  Do not skip liveness when the deployment policy requires it.
8.  Do not persist raw frames by default.
9.  Do not compare incompatible embeddings.
10. Do not require Internet for local recognition.
11. Do not create attendance before local persistence succeeds.
12. Do not create one attendance event per frame.
13. Do not let sync block recognition.
14. Do not let camera frame queues grow without bounds.
15. Do not overwrite profiles silently.
16. Do not activate incomplete profiles.
17. Do not expose biometric data unnecessarily.
18. Do not commit real biometric data to source control.
19. Do not hard-code model paths.
20. Do not hard-code camera IDs.
21. Do not hide model version.
22. Do not ignore false-positive testing.
23. Do not assume development hardware represents production.
24. Do not make security-sensitive decisions from a single noisy
    measurement when temporal evidence is available.
25. Prefer explicit states, typed results, transactional persistence,
    and replaceable adapters.

# 90 Detailed Agent Implementation Dossiers

The following dossiers are intentionally explicit. Each subsystem must
be implemented with the same discipline: clear inputs, outputs, state,
configuration, failure behavior, observability, tests, and acceptance
criteria. Agents should use these dossiers as implementation checklists
rather than treating the earlier architecture diagrams as sufficient
detail.

## Dossier 01 --- Product Charter

### Objective

The implementation for **Product Charter** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Product Charter can be exercised without requiring unrelated UI
    code.

-   Product Charter has a deterministic failure mode for invalid input.

-   Product Charter can be replaced without changing the public domain
    API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Product Charter.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 02 --- Core Architecture

### Objective

The implementation for **Core Architecture** must have a single,
explicit responsibility. It must not silently absorb responsibilities
from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Core Architecture can be exercised without requiring unrelated UI
    code.

-   Core Architecture has a deterministic failure mode for invalid
    input.

-   Core Architecture can be replaced without changing the public domain
    API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Core Architecture.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 03 --- Electron

### Objective

The implementation for **Electron** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Electron can be exercised without requiring unrelated UI code.

-   Electron has a deterministic failure mode for invalid input.

-   Electron can be replaced without changing the public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Electron.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 04 --- Camera

### Objective

The implementation for **Camera** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Camera can be exercised without requiring unrelated UI code.

-   Camera has a deterministic failure mode for invalid input.

-   Camera can be replaced without changing the public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Camera.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 05 --- Frame Pipeline

### Objective

The implementation for **Frame Pipeline** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Frame Pipeline can be exercised without requiring unrelated UI code.

-   Frame Pipeline has a deterministic failure mode for invalid input.

-   Frame Pipeline can be replaced without changing the public domain
    API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Frame Pipeline.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 06 --- Face Detection

### Objective

The implementation for **Face Detection** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Face Detection can be exercised without requiring unrelated UI code.

-   Face Detection has a deterministic failure mode for invalid input.

-   Face Detection can be replaced without changing the public domain
    API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Face Detection.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 07 --- Face Tracking

### Objective

The implementation for **Face Tracking** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Face Tracking can be exercised without requiring unrelated UI code.

-   Face Tracking has a deterministic failure mode for invalid input.

-   Face Tracking can be replaced without changing the public domain
    API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Face Tracking.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 08 --- Landmarks

### Objective

The implementation for **Landmarks** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Landmarks can be exercised without requiring unrelated UI code.

-   Landmarks has a deterministic failure mode for invalid input.

-   Landmarks can be replaced without changing the public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Landmarks.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 09 --- Face Alignment

### Objective

The implementation for **Face Alignment** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Face Alignment can be exercised without requiring unrelated UI code.

-   Face Alignment has a deterministic failure mode for invalid input.

-   Face Alignment can be replaced without changing the public domain
    API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Face Alignment.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 10 --- Head Pose

### Objective

The implementation for **Head Pose** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Head Pose can be exercised without requiring unrelated UI code.

-   Head Pose has a deterministic failure mode for invalid input.

-   Head Pose can be replaced without changing the public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Head Pose.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 11 --- Face Quality

### Objective

The implementation for **Face Quality** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Face Quality can be exercised without requiring unrelated UI code.

-   Face Quality has a deterministic failure mode for invalid input.

-   Face Quality can be replaced without changing the public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Face Quality.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 12 --- Blur

### Objective

The implementation for **Blur** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Blur can be exercised without requiring unrelated UI code.

-   Blur has a deterministic failure mode for invalid input.

-   Blur can be replaced without changing the public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Blur.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 13 --- Lighting

### Objective

The implementation for **Lighting** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Lighting can be exercised without requiring unrelated UI code.

-   Lighting has a deterministic failure mode for invalid input.

-   Lighting can be replaced without changing the public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Lighting.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 14 --- Occlusion

### Objective

The implementation for **Occlusion** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Occlusion can be exercised without requiring unrelated UI code.

-   Occlusion has a deterministic failure mode for invalid input.

-   Occlusion can be replaced without changing the public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Occlusion.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 15 --- Registration Product

### Objective

The implementation for **Registration Product** must have a single,
explicit responsibility. It must not silently absorb responsibilities
from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Registration Product can be exercised without requiring unrelated UI
    code.

-   Registration Product has a deterministic failure mode for invalid
    input.

-   Registration Product can be replaced without changing the public
    domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Registration Product.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 16 --- Registration State Machine

### Objective

The implementation for **Registration State Machine** must have a
single, explicit responsibility. It must not silently absorb
responsibilities from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Registration State Machine can be exercised without requiring
    unrelated UI code.

-   Registration State Machine has a deterministic failure mode for
    invalid input.

-   Registration State Machine can be replaced without changing the
    public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Registration State Machine.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 17 --- Registration Guidance

### Objective

The implementation for **Registration Guidance** must have a single,
explicit responsibility. It must not silently absorb responsibilities
from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Registration Guidance can be exercised without requiring unrelated
    UI code.

-   Registration Guidance has a deterministic failure mode for invalid
    input.

-   Registration Guidance can be replaced without changing the public
    domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Registration Guidance.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 18 --- Registration Stability

### Objective

The implementation for **Registration Stability** must have a single,
explicit responsibility. It must not silently absorb responsibilities
from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Registration Stability can be exercised without requiring unrelated
    UI code.

-   Registration Stability has a deterministic failure mode for invalid
    input.

-   Registration Stability can be replaced without changing the public
    domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Registration Stability.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 19 --- Registration Auto Capture

### Objective

The implementation for **Registration Auto Capture** must have a single,
explicit responsibility. It must not silently absorb responsibilities
from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Registration Auto Capture can be exercised without requiring
    unrelated UI code.

-   Registration Auto Capture has a deterministic failure mode for
    invalid input.

-   Registration Auto Capture can be replaced without changing the
    public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Registration Auto Capture.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 20 --- Registration Samples

### Objective

The implementation for **Registration Samples** must have a single,
explicit responsibility. It must not silently absorb responsibilities
from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Registration Samples can be exercised without requiring unrelated UI
    code.

-   Registration Samples has a deterministic failure mode for invalid
    input.

-   Registration Samples can be replaced without changing the public
    domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Registration Samples.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 21 --- Registration Review

### Objective

The implementation for **Registration Review** must have a single,
explicit responsibility. It must not silently absorb responsibilities
from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Registration Review can be exercised without requiring unrelated UI
    code.

-   Registration Review has a deterministic failure mode for invalid
    input.

-   Registration Review can be replaced without changing the public
    domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Registration Review.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 22 --- Registration Profile Build

### Objective

The implementation for **Registration Profile Build** must have a
single, explicit responsibility. It must not silently absorb
responsibilities from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Registration Profile Build can be exercised without requiring
    unrelated UI code.

-   Registration Profile Build has a deterministic failure mode for
    invalid input.

-   Registration Profile Build can be replaced without changing the
    public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Registration Profile Build.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 23 --- Face Profile

### Objective

The implementation for **Face Profile** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Face Profile can be exercised without requiring unrelated UI code.

-   Face Profile has a deterministic failure mode for invalid input.

-   Face Profile can be replaced without changing the public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Face Profile.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 24 --- Face Embedding

### Objective

The implementation for **Face Embedding** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Face Embedding can be exercised without requiring unrelated UI code.

-   Face Embedding has a deterministic failure mode for invalid input.

-   Face Embedding can be replaced without changing the public domain
    API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Face Embedding.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 25 --- Recognition

### Objective

The implementation for **Recognition** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Recognition can be exercised without requiring unrelated UI code.

-   Recognition has a deterministic failure mode for invalid input.

-   Recognition can be replaced without changing the public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Recognition.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 26 --- Similarity Search

### Objective

The implementation for **Similarity Search** must have a single,
explicit responsibility. It must not silently absorb responsibilities
from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Similarity Search can be exercised without requiring unrelated UI
    code.

-   Similarity Search has a deterministic failure mode for invalid
    input.

-   Similarity Search can be replaced without changing the public domain
    API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Similarity Search.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 27 --- Recognition Threshold

### Objective

The implementation for **Recognition Threshold** must have a single,
explicit responsibility. It must not silently absorb responsibilities
from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Recognition Threshold can be exercised without requiring unrelated
    UI code.

-   Recognition Threshold has a deterministic failure mode for invalid
    input.

-   Recognition Threshold can be replaced without changing the public
    domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Recognition Threshold.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 28 --- Recognition Temporal Policy

### Objective

The implementation for **Recognition Temporal Policy** must have a
single, explicit responsibility. It must not silently absorb
responsibilities from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Recognition Temporal Policy can be exercised without requiring
    unrelated UI code.

-   Recognition Temporal Policy has a deterministic failure mode for
    invalid input.

-   Recognition Temporal Policy can be replaced without changing the
    public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Recognition Temporal Policy.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 29 --- Ambiguity

### Objective

The implementation for **Ambiguity** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Ambiguity can be exercised without requiring unrelated UI code.

-   Ambiguity has a deterministic failure mode for invalid input.

-   Ambiguity can be replaced without changing the public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Ambiguity.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 30 --- Liveness

### Objective

The implementation for **Liveness** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Liveness can be exercised without requiring unrelated UI code.

-   Liveness has a deterministic failure mode for invalid input.

-   Liveness can be replaced without changing the public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Liveness.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 31 --- Active Liveness

### Objective

The implementation for **Active Liveness** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Active Liveness can be exercised without requiring unrelated UI
    code.

-   Active Liveness has a deterministic failure mode for invalid input.

-   Active Liveness can be replaced without changing the public domain
    API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Active Liveness.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 32 --- Passive Liveness

### Objective

The implementation for **Passive Liveness** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Passive Liveness can be exercised without requiring unrelated UI
    code.

-   Passive Liveness has a deterministic failure mode for invalid input.

-   Passive Liveness can be replaced without changing the public domain
    API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Passive Liveness.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 33 --- Attendance Product

### Objective

The implementation for **Attendance Product** must have a single,
explicit responsibility. It must not silently absorb responsibilities
from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Attendance Product can be exercised without requiring unrelated UI
    code.

-   Attendance Product has a deterministic failure mode for invalid
    input.

-   Attendance Product can be replaced without changing the public
    domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Attendance Product.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 34 --- Attendance State Machine

### Objective

The implementation for **Attendance State Machine** must have a single,
explicit responsibility. It must not silently absorb responsibilities
from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Attendance State Machine can be exercised without requiring
    unrelated UI code.

-   Attendance State Machine has a deterministic failure mode for
    invalid input.

-   Attendance State Machine can be replaced without changing the public
    domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Attendance State Machine.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 35 --- Attendance Business Rules

### Objective

The implementation for **Attendance Business Rules** must have a single,
explicit responsibility. It must not silently absorb responsibilities
from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Attendance Business Rules can be exercised without requiring
    unrelated UI code.

-   Attendance Business Rules has a deterministic failure mode for
    invalid input.

-   Attendance Business Rules can be replaced without changing the
    public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Attendance Business Rules.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 36 --- Duplicate Attendance

### Objective

The implementation for **Duplicate Attendance** must have a single,
explicit responsibility. It must not silently absorb responsibilities
from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Duplicate Attendance can be exercised without requiring unrelated UI
    code.

-   Duplicate Attendance has a deterministic failure mode for invalid
    input.

-   Duplicate Attendance can be replaced without changing the public
    domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Duplicate Attendance.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 37 --- Attendance Timestamp

### Objective

The implementation for **Attendance Timestamp** must have a single,
explicit responsibility. It must not silently absorb responsibilities
from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Attendance Timestamp can be exercised without requiring unrelated UI
    code.

-   Attendance Timestamp has a deterministic failure mode for invalid
    input.

-   Attendance Timestamp can be replaced without changing the public
    domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Attendance Timestamp.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 38 --- Offline Architecture

### Objective

The implementation for **Offline Architecture** must have a single,
explicit responsibility. It must not silently absorb responsibilities
from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Offline Architecture can be exercised without requiring unrelated UI
    code.

-   Offline Architecture has a deterministic failure mode for invalid
    input.

-   Offline Architecture can be replaced without changing the public
    domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Offline Architecture.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 39 --- SQLite

### Objective

The implementation for **SQLite** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   SQLite can be exercised without requiring unrelated UI code.

-   SQLite has a deterministic failure mode for invalid input.

-   SQLite can be replaced without changing the public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to SQLite.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 40 --- Database Tables

### Objective

The implementation for **Database Tables** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Database Tables can be exercised without requiring unrelated UI
    code.

-   Database Tables has a deterministic failure mode for invalid input.

-   Database Tables can be replaced without changing the public domain
    API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Database Tables.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 41 --- Attendance Transaction

### Objective

The implementation for **Attendance Transaction** must have a single,
explicit responsibility. It must not silently absorb responsibilities
from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Attendance Transaction can be exercised without requiring unrelated
    UI code.

-   Attendance Transaction has a deterministic failure mode for invalid
    input.

-   Attendance Transaction can be replaced without changing the public
    domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Attendance Transaction.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 42 --- Sync Queue

### Objective

The implementation for **Sync Queue** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Sync Queue can be exercised without requiring unrelated UI code.

-   Sync Queue has a deterministic failure mode for invalid input.

-   Sync Queue can be replaced without changing the public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Sync Queue.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 43 --- Sync Idempotency

### Objective

The implementation for **Sync Idempotency** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Sync Idempotency can be exercised without requiring unrelated UI
    code.

-   Sync Idempotency has a deterministic failure mode for invalid input.

-   Sync Idempotency can be replaced without changing the public domain
    API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Sync Idempotency.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 44 --- Profile Sync

### Objective

The implementation for **Profile Sync** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Profile Sync can be exercised without requiring unrelated UI code.

-   Profile Sync has a deterministic failure mode for invalid input.

-   Profile Sync can be replaced without changing the public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Profile Sync.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 45 --- Model Management

### Objective

The implementation for **Model Management** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Model Management can be exercised without requiring unrelated UI
    code.

-   Model Management has a deterministic failure mode for invalid input.

-   Model Management can be replaced without changing the public domain
    API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Model Management.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 46 --- Model Packaging

### Objective

The implementation for **Model Packaging** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Model Packaging can be exercised without requiring unrelated UI
    code.

-   Model Packaging has a deterministic failure mode for invalid input.

-   Model Packaging can be replaced without changing the public domain
    API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Model Packaging.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 47 --- Model Migration

### Objective

The implementation for **Model Migration** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Model Migration can be exercised without requiring unrelated UI
    code.

-   Model Migration has a deterministic failure mode for invalid input.

-   Model Migration can be replaced without changing the public domain
    API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Model Migration.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 48 --- Security

### Objective

The implementation for **Security** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Security can be exercised without requiring unrelated UI code.

-   Security has a deterministic failure mode for invalid input.

-   Security can be replaced without changing the public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Security.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 49 --- Privacy

### Objective

The implementation for **Privacy** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Privacy can be exercised without requiring unrelated UI code.

-   Privacy has a deterministic failure mode for invalid input.

-   Privacy can be replaced without changing the public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Privacy.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 50 --- UI Registration

### Objective

The implementation for **UI Registration** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   UI Registration can be exercised without requiring unrelated UI
    code.

-   UI Registration has a deterministic failure mode for invalid input.

-   UI Registration can be replaced without changing the public domain
    API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to UI Registration.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 51 --- UI Recognition

### Objective

The implementation for **UI Recognition** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   UI Recognition can be exercised without requiring unrelated UI code.

-   UI Recognition has a deterministic failure mode for invalid input.

-   UI Recognition can be replaced without changing the public domain
    API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to UI Recognition.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 52 --- UI Diagnostics

### Objective

The implementation for **UI Diagnostics** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   UI Diagnostics can be exercised without requiring unrelated UI code.

-   UI Diagnostics has a deterministic failure mode for invalid input.

-   UI Diagnostics can be replaced without changing the public domain
    API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to UI Diagnostics.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 53 --- UX Guidance

### Objective

The implementation for **UX Guidance** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   UX Guidance can be exercised without requiring unrelated UI code.

-   UX Guidance has a deterministic failure mode for invalid input.

-   UX Guidance can be replaced without changing the public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to UX Guidance.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 54 --- UX Hysteresis

### Objective

The implementation for **UX Hysteresis** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   UX Hysteresis can be exercised without requiring unrelated UI code.

-   UX Hysteresis has a deterministic failure mode for invalid input.

-   UX Hysteresis can be replaced without changing the public domain
    API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to UX Hysteresis.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 55 --- Accessibility

### Objective

The implementation for **Accessibility** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Accessibility can be exercised without requiring unrelated UI code.

-   Accessibility has a deterministic failure mode for invalid input.

-   Accessibility can be replaced without changing the public domain
    API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Accessibility.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 56 --- Error Handling

### Objective

The implementation for **Error Handling** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Error Handling can be exercised without requiring unrelated UI code.

-   Error Handling has a deterministic failure mode for invalid input.

-   Error Handling can be replaced without changing the public domain
    API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Error Handling.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 57 --- Logging

### Objective

The implementation for **Logging** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Logging can be exercised without requiring unrelated UI code.

-   Logging has a deterministic failure mode for invalid input.

-   Logging can be replaced without changing the public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Logging.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 58 --- Performance

### Objective

The implementation for **Performance** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Performance can be exercised without requiring unrelated UI code.

-   Performance has a deterministic failure mode for invalid input.

-   Performance can be replaced without changing the public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Performance.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 59 --- Testing

### Objective

The implementation for **Testing** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Testing can be exercised without requiring unrelated UI code.

-   Testing has a deterministic failure mode for invalid input.

-   Testing can be replaced without changing the public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Testing.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 60 --- Security Testing

### Objective

The implementation for **Security Testing** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Security Testing can be exercised without requiring unrelated UI
    code.

-   Security Testing has a deterministic failure mode for invalid input.

-   Security Testing can be replaced without changing the public domain
    API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Security Testing.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 61 --- Performance Testing

### Objective

The implementation for **Performance Testing** must have a single,
explicit responsibility. It must not silently absorb responsibilities
from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Performance Testing can be exercised without requiring unrelated UI
    code.

-   Performance Testing has a deterministic failure mode for invalid
    input.

-   Performance Testing can be replaced without changing the public
    domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Performance Testing.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 62 --- Edge Cases

### Objective

The implementation for **Edge Cases** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Edge Cases can be exercised without requiring unrelated UI code.

-   Edge Cases has a deterministic failure mode for invalid input.

-   Edge Cases can be replaced without changing the public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Edge Cases.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 63 --- Device Modes

### Objective

The implementation for **Device Modes** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Device Modes can be exercised without requiring unrelated UI code.

-   Device Modes has a deterministic failure mode for invalid input.

-   Device Modes can be replaced without changing the public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Device Modes.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 64 --- Device Identity

### Objective

The implementation for **Device Identity** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Device Identity can be exercised without requiring unrelated UI
    code.

-   Device Identity has a deterministic failure mode for invalid input.

-   Device Identity can be replaced without changing the public domain
    API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Device Identity.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 65 --- Kiosk Mode

### Objective

The implementation for **Kiosk Mode** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Kiosk Mode can be exercised without requiring unrelated UI code.

-   Kiosk Mode has a deterministic failure mode for invalid input.

-   Kiosk Mode can be replaced without changing the public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Kiosk Mode.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 66 --- Recognition 1:N

### Objective

The implementation for **Recognition 1:N** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Recognition 1:N can be exercised without requiring unrelated UI
    code.

-   Recognition 1:N has a deterministic failure mode for invalid input.

-   Recognition 1:N can be replaced without changing the public domain
    API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Recognition 1:N.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 67 --- Verification 1:1

### Objective

The implementation for **Verification 1:1** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Verification 1:1 can be exercised without requiring unrelated UI
    code.

-   Verification 1:1 has a deterministic failure mode for invalid input.

-   Verification 1:1 can be replaced without changing the public domain
    API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Verification 1:1.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 68 --- Future Access Control

### Objective

The implementation for **Future Access Control** must have a single,
explicit responsibility. It must not silently absorb responsibilities
from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Future Access Control can be exercised without requiring unrelated
    UI code.

-   Future Access Control has a deterministic failure mode for invalid
    input.

-   Future Access Control can be replaced without changing the public
    domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Future Access Control.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 69 --- Future Server

### Objective

The implementation for **Future Server** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Future Server can be exercised without requiring unrelated UI code.

-   Future Server has a deterministic failure mode for invalid input.

-   Future Server can be replaced without changing the public domain
    API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Future Server.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 70 --- Deployment

### Objective

The implementation for **Deployment** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Deployment can be exercised without requiring unrelated UI code.

-   Deployment has a deterministic failure mode for invalid input.

-   Deployment can be replaced without changing the public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Deployment.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 71 --- Data Retention

### Objective

The implementation for **Data Retention** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Data Retention can be exercised without requiring unrelated UI code.

-   Data Retention has a deterministic failure mode for invalid input.

-   Data Retention can be replaced without changing the public domain
    API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Data Retention.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 72 --- Operational Runbook

### Objective

The implementation for **Operational Runbook** must have a single,
explicit responsibility. It must not silently absorb responsibilities
from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Operational Runbook can be exercised without requiring unrelated UI
    code.

-   Operational Runbook has a deterministic failure mode for invalid
    input.

-   Operational Runbook can be replaced without changing the public
    domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Operational Runbook.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 73 --- AI Agent Implementation Rules

### Objective

The implementation for **AI Agent Implementation Rules** must have a
single, explicit responsibility. It must not silently absorb
responsibilities from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   AI Agent Implementation Rules can be exercised without requiring
    unrelated UI code.

-   AI Agent Implementation Rules has a deterministic failure mode for
    invalid input.

-   AI Agent Implementation Rules can be replaced without changing the
    public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to AI Agent Implementation Rules.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 74 --- Definition of Done

### Objective

The implementation for **Definition of Done** must have a single,
explicit responsibility. It must not silently absorb responsibilities
from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Definition of Done can be exercised without requiring unrelated UI
    code.

-   Definition of Done has a deterministic failure mode for invalid
    input.

-   Definition of Done can be replaced without changing the public
    domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Definition of Done.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 75 --- Reference Type Contracts

### Objective

The implementation for **Reference Type Contracts** must have a single,
explicit responsibility. It must not silently absorb responsibilities
from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Reference Type Contracts can be exercised without requiring
    unrelated UI code.

-   Reference Type Contracts has a deterministic failure mode for
    invalid input.

-   Reference Type Contracts can be replaced without changing the public
    domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Reference Type Contracts.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 76 --- Database Contract

### Objective

The implementation for **Database Contract** must have a single,
explicit responsibility. It must not silently absorb responsibilities
from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Database Contract can be exercised without requiring unrelated UI
    code.

-   Database Contract has a deterministic failure mode for invalid
    input.

-   Database Contract can be replaced without changing the public domain
    API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Database Contract.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 77 --- Registration Flow Contract

### Objective

The implementation for **Registration Flow Contract** must have a
single, explicit responsibility. It must not silently absorb
responsibilities from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Registration Flow Contract can be exercised without requiring
    unrelated UI code.

-   Registration Flow Contract has a deterministic failure mode for
    invalid input.

-   Registration Flow Contract can be replaced without changing the
    public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Registration Flow Contract.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 78 --- Recognition Flow Contract

### Objective

The implementation for **Recognition Flow Contract** must have a single,
explicit responsibility. It must not silently absorb responsibilities
from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Recognition Flow Contract can be exercised without requiring
    unrelated UI code.

-   Recognition Flow Contract has a deterministic failure mode for
    invalid input.

-   Recognition Flow Contract can be replaced without changing the
    public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Recognition Flow Contract.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 79 --- Attendance Flow Contract

### Objective

The implementation for **Attendance Flow Contract** must have a single,
explicit responsibility. It must not silently absorb responsibilities
from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Attendance Flow Contract can be exercised without requiring
    unrelated UI code.

-   Attendance Flow Contract has a deterministic failure mode for
    invalid input.

-   Attendance Flow Contract can be replaced without changing the public
    domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Attendance Flow Contract.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 80 --- Failure Matrix

### Objective

The implementation for **Failure Matrix** must have a single, explicit
responsibility. It must not silently absorb responsibilities from
unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Failure Matrix can be exercised without requiring unrelated UI code.

-   Failure Matrix has a deterministic failure mode for invalid input.

-   Failure Matrix can be replaced without changing the public domain
    API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Failure Matrix.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 81 --- Security Failure Matrix

### Objective

The implementation for **Security Failure Matrix** must have a single,
explicit responsibility. It must not silently absorb responsibilities
from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Security Failure Matrix can be exercised without requiring unrelated
    UI code.

-   Security Failure Matrix has a deterministic failure mode for invalid
    input.

-   Security Failure Matrix can be replaced without changing the public
    domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Security Failure Matrix.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 82 --- Performance Budget Template

### Objective

The implementation for **Performance Budget Template** must have a
single, explicit responsibility. It must not silently absorb
responsibilities from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Performance Budget Template can be exercised without requiring
    unrelated UI code.

-   Performance Budget Template has a deterministic failure mode for
    invalid input.

-   Performance Budget Template can be replaced without changing the
    public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Performance Budget Template.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 83 --- Recognition Evaluation Template

### Objective

The implementation for **Recognition Evaluation Template** must have a
single, explicit responsibility. It must not silently absorb
responsibilities from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Recognition Evaluation Template can be exercised without requiring
    unrelated UI code.

-   Recognition Evaluation Template has a deterministic failure mode for
    invalid input.

-   Recognition Evaluation Template can be replaced without changing the
    public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Recognition Evaluation Template.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 84 --- Registration Evaluation Template

### Objective

The implementation for **Registration Evaluation Template** must have a
single, explicit responsibility. It must not silently absorb
responsibilities from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Registration Evaluation Template can be exercised without requiring
    unrelated UI code.

-   Registration Evaluation Template has a deterministic failure mode
    for invalid input.

-   Registration Evaluation Template can be replaced without changing
    the public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Registration Evaluation Template.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 85 --- Release Checklist

### Objective

The implementation for **Release Checklist** must have a single,
explicit responsibility. It must not silently absorb responsibilities
from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Release Checklist can be exercised without requiring unrelated UI
    code.

-   Release Checklist has a deterministic failure mode for invalid
    input.

-   Release Checklist can be replaced without changing the public domain
    API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Release Checklist.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 86 --- Suggested ADR Files

### Objective

The implementation for **Suggested ADR Files** must have a single,
explicit responsibility. It must not silently absorb responsibilities
from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Suggested ADR Files can be exercised without requiring unrelated UI
    code.

-   Suggested ADR Files has a deterministic failure mode for invalid
    input.

-   Suggested ADR Files can be replaced without changing the public
    domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Suggested ADR Files.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 87 --- Suggested Project Layout

### Objective

The implementation for **Suggested Project Layout** must have a single,
explicit responsibility. It must not silently absorb responsibilities
from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Suggested Project Layout can be exercised without requiring
    unrelated UI code.

-   Suggested Project Layout has a deterministic failure mode for
    invalid input.

-   Suggested Project Layout can be replaced without changing the public
    domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Suggested Project Layout.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 88 --- Coding Agent Execution Plan

### Objective

The implementation for **Coding Agent Execution Plan** must have a
single, explicit responsibility. It must not silently absorb
responsibilities from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Coding Agent Execution Plan can be exercised without requiring
    unrelated UI code.

-   Coding Agent Execution Plan has a deterministic failure mode for
    invalid input.

-   Coding Agent Execution Plan can be replaced without changing the
    public domain API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Coding Agent Execution Plan.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

## Dossier 89 --- Final Agent Rules

### Objective

The implementation for **Final Agent Rules** must have a single,
explicit responsibility. It must not silently absorb responsibilities
from unrelated layers.

### Inputs

-   Typed configuration relevant to the subsystem.

-   Typed domain/application input rather than raw UI state.

-   Current session or device context when required.

-   Model metadata when the operation depends on an AI model.

-   Explicit cancellation/timeout context where the operation may be
    long-running. \### Outputs

-   A typed result.

-   A typed failure code when the operation cannot complete.

-   Processing duration for diagnostics where useful.

-   Version metadata when the result depends on a model or policy. \###
    State Requirements

-   State transitions must be explicit.

-   Invalid transitions must be rejected rather than silently ignored.

-   Cancellation must leave the subsystem in a safe state.

-   Restart must recover persisted state or discard temporary state
    safely.

-   Transient camera frames must not become durable state unless
    explicitly requested. \### Configuration

-   Configuration values must live in a typed configuration object.

-   Avoid magic numbers in components.

-   Configuration must be validated before use.

-   Changes to security-sensitive thresholds should be versioned or
    auditable.

-   Defaults must be conservative and documented. \### Error Handling

-   Distinguish expected user-correctable failures from infrastructure
    failures.

-   Return stable error codes.

-   Do not expose stack traces to normal users.

-   Do not convert infrastructure failure into a successful business
    result.

-   Make retry behavior explicit. \### Logging

-   Log lifecycle transitions where useful.

-   Log timing and failure codes.

-   Do not log raw face images by default.

-   Do not log embeddings by default.

-   Avoid personally identifying data in generic diagnostics. \###
    Testing

-   Unit-test normal operation.

-   Unit-test invalid input.

-   Unit-test cancellation.

-   Unit-test timeout.

-   Unit-test repeated invocation.

-   Unit-test recovery after failure.

-   Add integration tests at the boundary with neighboring services.

-   Use mocks for camera and AI dependencies where deterministic tests
    are required. \### Acceptance Criteria

-   Final Agent Rules can be exercised without requiring unrelated UI
    code.

-   Final Agent Rules has a deterministic failure mode for invalid
    input.

-   Final Agent Rules can be replaced without changing the public domain
    API.

-   The implementation does not leak sensitive infrastructure into the
    renderer.

-   The implementation has automated tests for its critical rules.

-   Diagnostics can identify whether the subsystem is ready, degraded,
    or failed. \### AI Agent Implementation Tasks

1.  Locate existing code related to Final Agent Rules.
2.  Identify reusable abstractions before creating new files.
3.  Define or reuse the typed interface.
4.  Define domain errors.
5.  Implement the simplest deterministic version.
6.  Add unit tests before model/hardware integration where possible.
7.  Integrate the real infrastructure adapter.
8.  Add diagnostics.
9.  Add failure recovery.
10. Update the relevant ADR and project documentation.

# 91 Detailed Scenario Matrices

## Registration

### Registration Scenario 1: user enters frame

-   **Trigger:** user enters frame.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Registration Scenario 2: user leaves frame

-   **Trigger:** user leaves frame.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Registration Scenario 3: two faces enter frame

-   **Trigger:** two faces enter frame.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Registration Scenario 4: face is too small

-   **Trigger:** face is too small.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Registration Scenario 5: face is too large

-   **Trigger:** face is too large.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Registration Scenario 6: pose enters tolerance

-   **Trigger:** pose enters tolerance.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Registration Scenario 7: pose leaves tolerance during stability

-   **Trigger:** pose leaves tolerance during stability.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Registration Scenario 8: quality passes

-   **Trigger:** quality passes.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Registration Scenario 9: quality fails

-   **Trigger:** quality fails.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Registration Scenario 10: camera disconnects during capture

-   **Trigger:** camera disconnects during capture.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Registration Scenario 11: user cancels

-   **Trigger:** user cancels.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Registration Scenario 12: embedding fails

-   **Trigger:** embedding fails.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Registration Scenario 13: database commit fails

-   **Trigger:** database commit fails.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Registration Scenario 14: profile already exists

-   **Trigger:** profile already exists.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Registration Scenario 15: application crashes before completion

-   **Trigger:** application crashes before completion.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

## Recognition

### Recognition Scenario 1: no face

-   **Trigger:** no face.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Recognition Scenario 2: one known face

-   **Trigger:** one known face.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Recognition Scenario 3: one unknown face

-   **Trigger:** one unknown face.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Recognition Scenario 4: multiple faces

-   **Trigger:** multiple faces.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Recognition Scenario 5: low quality

-   **Trigger:** low quality.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Recognition Scenario 6: liveness fails

-   **Trigger:** liveness fails.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Recognition Scenario 7: best candidate below threshold

-   **Trigger:** best candidate below threshold.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Recognition Scenario 8: best candidate above threshold

-   **Trigger:** best candidate above threshold.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Recognition Scenario 9: best and second candidate are ambiguous

-   **Trigger:** best and second candidate are ambiguous.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Recognition Scenario 10: identity is stable across frames

-   **Trigger:** identity is stable across frames.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Recognition Scenario 11: identity changes across frames

-   **Trigger:** identity changes across frames.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Recognition Scenario 12: camera disconnects

-   **Trigger:** camera disconnects.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Recognition Scenario 13: model becomes unavailable

-   **Trigger:** model becomes unavailable.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Recognition Scenario 14: profile index is empty

-   **Trigger:** profile index is empty.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Recognition Scenario 15: profile index changes during recognition

-   **Trigger:** profile index changes during recognition.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

## Attendance

### Attendance Scenario 1: first check-in

-   **Trigger:** first check-in.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Attendance Scenario 2: duplicate check-in

-   **Trigger:** duplicate check-in.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Attendance Scenario 3: cooldown active

-   **Trigger:** cooldown active.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Attendance Scenario 4: employee inactive

-   **Trigger:** employee inactive.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Attendance Scenario 5: wrong attendance mode

-   **Trigger:** wrong attendance mode.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Attendance Scenario 6: offline check-in

-   **Trigger:** offline check-in.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Attendance Scenario 7: server timeout

-   **Trigger:** server timeout.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Attendance Scenario 8: server accepts after retry

-   **Trigger:** server accepts after retry.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Attendance Scenario 9: duplicate server request

-   **Trigger:** duplicate server request.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Attendance Scenario 10: database failure

-   **Trigger:** database failure.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Attendance Scenario 11: device clock drift

-   **Trigger:** device clock drift.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Attendance Scenario 12: app restarts after local commit

-   **Trigger:** app restarts after local commit.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Attendance Scenario 13: unknown identity

-   **Trigger:** unknown identity.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Attendance Scenario 14: ambiguous identity

-   **Trigger:** ambiguous identity.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Attendance Scenario 15: liveness failure

-   **Trigger:** liveness failure.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

## Camera

### Camera Scenario 1: no camera devices

-   **Trigger:** no camera devices.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Camera Scenario 2: permission denied

-   **Trigger:** permission denied.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Camera Scenario 3: permission revoked

-   **Trigger:** permission revoked.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Camera Scenario 4: camera opens

-   **Trigger:** camera opens.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Camera Scenario 5: camera fails to open

-   **Trigger:** camera fails to open.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Camera Scenario 6: camera unplugged

-   **Trigger:** camera unplugged.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Camera Scenario 7: camera reconnected

-   **Trigger:** camera reconnected.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Camera Scenario 8: camera returns black frames

-   **Trigger:** camera returns black frames.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Camera Scenario 9: camera freezes

-   **Trigger:** camera freezes.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Camera Scenario 10: multiple cameras

-   **Trigger:** multiple cameras.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Camera Scenario 11: selected camera disappears

-   **Trigger:** selected camera disappears.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Camera Scenario 12: frame processing is slower than camera FPS

-   **Trigger:** frame processing is slower than camera FPS.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

## Sync

### Sync Scenario 1: network unavailable

-   **Trigger:** network unavailable.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Sync Scenario 2: network becomes available

-   **Trigger:** network becomes available.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Sync Scenario 3: request timeout

-   **Trigger:** request timeout.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Sync Scenario 4: server returns 401

-   **Trigger:** server returns 401.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Sync Scenario 5: server returns 409

-   **Trigger:** server returns 409.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Sync Scenario 6: server returns 500

-   **Trigger:** server returns 500.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Sync Scenario 7: duplicate event submitted

-   **Trigger:** duplicate event submitted.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Sync Scenario 8: queue contains stale PROCESSING item

-   **Trigger:** queue contains stale PROCESSING item.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Sync Scenario 9: device restarts with pending events

-   **Trigger:** device restarts with pending events.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

### Sync Scenario 10: large backlog

-   **Trigger:** large backlog.
-   **Expected state:** move to the explicitly defined safe state.
-   **User feedback:** provide one actionable instruction when the user
    can correct the problem.
-   **Persistence:** do not persist transient frame data unless
    required.
-   **Security:** do not create an identity or attendance event unless
    all gates pass.
-   **Recovery:** retry automatically only when retry is safe; otherwise
    require user/admin action.
-   **Logging:** record a stable event/error code.
-   **Test:** reproduce the condition with a deterministic mock before
    relying on hardware.

# 92 Detailed Data Contracts

## Person Contract

Required: - stable UUID; - employee/business identifier; - display
name; - active/inactive state; - creation timestamp; - update timestamp.

Rules: - employee identifier must have a uniqueness policy; - display
name is presentation data; - biometric data must not be embedded
directly into Person; - deleting or disabling a Person must have
explicit profile and attendance semantics.

## Face Profile Contract

Required: - profile UUID; - person UUID; - lifecycle state; - profile
version; - model family; - model version; - preprocessing version; -
timestamps.

Rules: - only ACTIVE profiles enter recognition; - DRAFT profiles cannot
be matched; - replacement must be atomic; - model metadata must remain
attached to embeddings.

## Attendance Contract

Required: - immutable event UUID; - person UUID; - timestamp; - device
UUID; - event type; - recognition/policy metadata; - synchronization
state.

Rules: - local persistence precedes success UI; - server sync must be
idempotent; - historical attendance is independent from current profile
activation; - corrections require an explicit audit trail.

# 93 Detailed IPC Contract

Every IPC method must define: - request schema; - response schema; -
authorization requirement; - timeout; - error codes; - cancellation
behavior; - logging policy.

Recommended channels: - camera:listDevices - camera:getState -
camera:selectDevice - camera:start - camera:stop -
face:getCapabilities - face:registration:start -
face:registration:cancel - face:registration:retry -
face:registration:complete - face:recognition:start -
face:recognition:stop - face:profile:get - face:profile:delete -
attendance:checkIn - attendance:history - diagnostics:getHealth -
diagnostics:getMetrics - sync:getStatus

Never expose: - generic SQL; - arbitrary filesystem paths; - arbitrary
process execution; - generic shell commands; - arbitrary model
execution; - unrestricted network requests.

# 94 Detailed State-Machine Rules

Every state machine must define: - initial state; - allowed events; -
guards; - side effects; - timeout; - cancellation; - terminal states; -
recovery state.

Registration: - no capture outside CAPTURING; - no profile activation
outside COMPLETED; - no task advancement after failed validation; -
cancellation cleans temporary resources.

Recognition: - no identity result without a valid face; - no MATCH
without threshold; - no verified result when required liveness fails; -
no attendance commit from stale recognition state.

Attendance: - no SUCCESS before transaction commit; - duplicate policy
is evaluated before insert; - sync is asynchronous after local commit.

# 95 Detailed Configuration Contract

Configuration should be grouped:

``` text
camera
  deviceId
  width
  height
  fps

detection
  confidenceThreshold
  minFaceSize

pose
  frontTarget
  leftTarget
  rightTarget
  upTarget
  downTarget
  tolerance

quality
  minOverall
  minSharpness
  minBrightness
  minFaceSize
  maxFaceSize

registration
  stabilityMs
  countdownMs
  requiredTasks

recognition
  similarityThreshold
  ambiguityMargin
  temporalWindow
  requiredVotes

liveness
  enabled
  mode
  threshold
  challengeTimeout

attendance
  cooldownSeconds
  duplicateWindow
  mode

sync
  enabled
  retryBaseMs
  retryMaxMs
  batchSize
```

All security-sensitive values must have safe bounds.

# 96 Detailed Model Lifecycle

``` text
DISCOVER
 ↓
VALIDATE
 ↓
LOAD
 ↓
WARMUP
 ↓
READY
 ↓
ACTIVE
 ↓
DEACTIVATE
 ↓
REMOVE
```

Model validation must check: - files exist; - checksum is valid; -
metadata is readable; - runtime can load it; - output dimensions match
expected values; - preprocessing metadata is present; - a sanity
inference succeeds.

# 97 Detailed Recognition Index Lifecycle

``` text
EMPTY
 ↓
LOADING
 ↓
READY
 ↓
REBUILDING
 ↓
READY
```

During rebuild: - keep the old index active if possible; - build the new
index separately; - validate all embeddings; - atomically swap; -
release the old index after no active readers remain.

# 98 Detailed Privacy Rules

Default: - camera frames are transient; - recognition embeddings are
transient until needed; - raw samples are not retained; - logs contain
no biometric payload; - diagnostic exports contain no raw face data.

If raw samples are required: - document purpose; - encrypt or protect
storage; - define retention; - define deletion; - restrict access; -
audit access.

# 99 Detailed Performance Rules

The system must prefer: - latest-frame processing; - bounded queues; -
model reuse; - early quality rejection; - temporal confirmation; - index
snapshots; - typed arrays for vector math.

Avoid: - React state updates per frame; - repeated model
initialization; - repeated database queries for every frame; -
full-resolution frame copies when unnecessary; - unbounded async
inference promises.

# 100 Detailed Acceptance Test Scenarios

## Registration

1.  Start with valid person.
2.  Start with inactive person if policy forbids registration.
3.  Camera permission denied.
4.  Camera disconnected.
5.  No face.
6.  Multiple faces.
7.  Face too small.
8.  Face too large.
9.  Wrong pose.
10. Correct pose.
11. Correct pose but unstable.
12. Stable pose but poor quality.
13. Stable and good quality.
14. Automatic capture.
15. Retry.
16. Cancel.
17. Complete all tasks.
18. Embedding failure.
19. Database failure.
20. Existing profile replacement.

## Recognition

1.  Known person.
2.  Unknown person.
3.  Similar-looking impostor.
4.  Low quality.
5.  Multiple faces.
6.  Liveness failure.
7.  Model unavailable.
8.  Empty profile index.
9.  Ambiguous top two.
10. Stable identity.
11. Identity changes.
12. Face disappears.
13. Network unavailable.
14. Database unavailable.

## Attendance

1.  First valid check-in.
2.  Duplicate within cooldown.
3.  Duplicate same shift.
4.  Inactive person.
5.  Unknown.
6.  Liveness failure.
7.  Local database commit.
8.  Sync queue creation.
9.  Network loss.
10. Network recovery.
11. Duplicate server request.
12. Application restart.
13. Clock drift.
14. Device revocation.

# 101 Agent Review Questions

Before marking a feature complete, the agent must be able to answer:

-   What owns this state?
-   What is the public interface?
-   What data crosses the renderer boundary?
-   What happens when the camera disappears?
-   What happens when inference is slower than the camera?
-   What happens when no face exists?
-   What happens when multiple faces exist?
-   What happens when quality is bad?
-   What happens when identity is uncertain?
-   What happens when liveness fails?
-   What happens when SQLite fails?
-   What happens when the network fails?
-   What happens when the app crashes?
-   What happens when the model changes?
-   What data is retained?
-   What data is logged?
-   What is the recovery action?
-   What automated test proves the behavior?

# 102 Final Engineering Constraint

Correctness is more important than demo smoothness.

The system must prefer: - UNKNOWN over a false identity; - retry over an
unsafe match; - local durable storage over a false success; - explicit
degraded mode over silent failure; - replaceable adapters over vendor
lock-in; - deterministic state transitions over implicit UI side
effects; - measurable thresholds over guessed thresholds.

# 103 Per-Subsystem Implementation Worksheets

## 01 --- Product Charter Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 02 --- Core Architecture Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 03 --- Electron Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 04 --- Camera Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 05 --- Frame Pipeline Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 06 --- Face Detection Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 07 --- Face Tracking Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 08 --- Landmarks Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 09 --- Face Alignment Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 10 --- Head Pose Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 11 --- Face Quality Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 12 --- Blur Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 13 --- Lighting Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 14 --- Occlusion Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 15 --- Registration Product Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 16 --- Registration State Machine Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 17 --- Registration Guidance Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 18 --- Registration Stability Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 19 --- Registration Auto Capture Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 20 --- Registration Samples Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 21 --- Registration Review Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 22 --- Registration Profile Build Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 23 --- Face Profile Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 24 --- Face Embedding Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 25 --- Recognition Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 26 --- Similarity Search Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 27 --- Recognition Threshold Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 28 --- Recognition Temporal Policy Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 29 --- Ambiguity Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 30 --- Liveness Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 31 --- Active Liveness Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 32 --- Passive Liveness Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 33 --- Attendance Product Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 34 --- Attendance State Machine Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 35 --- Attendance Business Rules Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 36 --- Duplicate Attendance Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 37 --- Attendance Timestamp Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 38 --- Offline Architecture Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 39 --- SQLite Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 40 --- Database Tables Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 41 --- Attendance Transaction Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 42 --- Sync Queue Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 43 --- Sync Idempotency Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 44 --- Profile Sync Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 45 --- Model Management Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 46 --- Model Packaging Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 47 --- Model Migration Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 48 --- Security Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 49 --- Privacy Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 50 --- UI Registration Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 51 --- UI Recognition Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 52 --- UI Diagnostics Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 53 --- UX Guidance Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 54 --- UX Hysteresis Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 55 --- Accessibility Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 56 --- Error Handling Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 57 --- Logging Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 58 --- Performance Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 59 --- Testing Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 60 --- Security Testing Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 61 --- Performance Testing Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 62 --- Edge Cases Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 63 --- Device Modes Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 64 --- Device Identity Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 65 --- Kiosk Mode Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 66 --- Recognition 1:N Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 67 --- Verification 1:1 Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 68 --- Future Access Control Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 69 --- Future Server Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 70 --- Deployment Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 71 --- Data Retention Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 72 --- Operational Runbook Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 73 --- AI Agent Implementation Rules Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 74 --- Definition of Done Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 75 --- Reference Type Contracts Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 76 --- Database Contract Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 77 --- Registration Flow Contract Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 78 --- Recognition Flow Contract Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 79 --- Attendance Flow Contract Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 80 --- Failure Matrix Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 81 --- Security Failure Matrix Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 82 --- Performance Budget Template Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 83 --- Recognition Evaluation Template Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 84 --- Registration Evaluation Template Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 85 --- Release Checklist Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 86 --- Suggested ADR Files Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 87 --- Suggested Project Layout Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 88 --- Coding Agent Execution Plan Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

## 89 --- Final Agent Rules Worksheet

1.  **Repository files to inspect:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
2.  **Existing interfaces to reuse:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
3.  **New interfaces required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
4.  **Domain types required:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
5.  **Configuration values:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
6.  **State machine states:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
7.  **Events:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
8.  **Guards:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
9.  **Side effects:**
    -   Define explicitly before implementation.
    -   Keep the decision typed and testable.
10. **Persistence requirements:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

11. **Security boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

12. **IPC boundary:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

13. **UI states:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

14. **UX messages:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

15. **Localization keys:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

16. **Failure codes:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

17. **Retry behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

18. **Timeout behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

19. **Cancellation behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

20. **Telemetry fields:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

21. **Performance metrics:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

22. **Memory considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

23. **CPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

24. **GPU considerations:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

25. **Test fixtures:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

26. **Mock dependencies:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

27. **Unit tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

28. **Integration tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

29. **Hardware tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

30. **Security tests:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

31. **Acceptance criteria:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

32. **Regression risks:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

33. **Migration concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

34. **Deployment concerns:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

35. **Rollback behavior:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

36. **Documentation updates:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

37. **ADR required?:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

38. **Open decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

39. **Default decision:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

40. **Reason:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

41. **Owner:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.

42. **Status:**

-   Define explicitly before implementation.
-   Keep the decision typed and testable.
