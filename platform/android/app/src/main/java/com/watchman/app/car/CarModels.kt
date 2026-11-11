package com.watchman.app.car

enum class FailKind { SIGNED_OUT, NOT_PATROLLER, NO_ORG, OFFLINE, SERVER_OUTDATED, UNKNOWN }

sealed class CarResult<out T> {
    data class Ok<T>(val value: T) : CarResult<T>()
    data class Fail(val kind: FailKind) : CarResult<Nothing>()
}

data class LatLngAcc(val lat: Double, val lng: Double, val accuracy: Double?)

data class Me(
    val userId: String,
    val userName: String,
    val onPatrol: Boolean,
    val startMs: Long?,
    val vehicleLabel: String?,
    val distanceKm: Double?,
    val lastFix: LatLngAcc?,
)

data class Patroller(
    val userId: String,
    val name: String,
    val lat: Double,
    val lng: Double,
    val atMs: Long?,
    val isLive: Boolean,
    val distanceKm: Double?,
)

data class IncidentPin(
    val id: String,
    val type: String,
    val title: String,
    val address: String,
    val atMs: Long?,
    val lat: Double,
    val lng: Double,
    val distanceKm: Double?,
    val ackedByMe: Boolean,
    val ackCount: Int,
)

data class SosPin(
    val id: String,
    val incidentId: String,
    val createdMs: Long?,
    val acknowledged: Boolean,
    val ackedByMe: Boolean,
    val isMine: Boolean,
    val senderName: String,
    val lat: Double?,
    val lng: Double?,
    val address: String,
    val distanceKm: Double?,
)

data class Vehicle(val id: String, val label: String, val registration: String, val vehicleType: String? = null)

/** Everyone on patrol in the org, GPS optional. */
data class OnlinePatroller(
    val userId: String,
    val name: String,
    val startMs: Long?,
    val vehicleLabel: String?,
    val vehicleType: String?,
    val isMe: Boolean,
    val lat: Double?,
    val lng: Double?,
    val atMs: Long?,
    val isLive: Boolean,
)

data class RecentMessage(
    val id: String,
    val senderName: String,
    val atMs: Long?,
    val preview: String,
    val isCritical: Boolean,
)

data class PatrolSummary(
    val startMs: Long,
    val endMs: Long,
    val durationMinutes: Int,
    val distanceKm: Double,
)

data class Dashboard(
    val me: Me,
    val patrollers: List<Patroller>,
    val incidents: List<IncidentPin>,
    val sos: List<SosPin>,
    val serverTimeMs: Long,
    val orgCenter: LatLngAcc? = null,
    val onlinePatrollers: List<OnlinePatroller> = emptyList(),
    val recentMessages: List<RecentMessage> = emptyList(),
)

/** What check-in can answer with besides a plain failure. */
sealed class StartOutcome {
    data class Started(val startMs: Long?, val vehicleLabel: String?) : StartOutcome()
    data class AlreadyActive(val startMs: Long?) : StartOutcome()
    data class NeedsVehicle(val vehicles: List<Vehicle>) : StartOutcome()
}

sealed class EndOutcome {
    data class Ended(val summary: PatrolSummary) : EndOutcome()
    object NotActive : EndOutcome()
}

enum class SosOutcome { SENT, ALREADY_SENT }

enum class ReportOutcome { REPORTED, TOO_SOON }

enum class AckOutcome { ACKNOWLEDGED, ALREADY }
