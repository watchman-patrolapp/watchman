package com.watchman.app.car

import java.util.TimeZone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CarLogicTest {

    private val johannesburg: TimeZone = TimeZone.getTimeZone("Africa/Johannesburg")

    // 2026-11-11 19:04:00 UTC = 21:04 in Johannesburg (UTC+2), a Wednesday.
    private val start = 1_794_423_840_000L

    @Test
    fun haversine_pointZeroOneDegreeOfLongitudeAtMinus30() {
        assertEquals(0.963, CarLogic.haversineKm(-30.0, 30.0, -30.0, 30.01), 0.005)
    }

    @Test
    fun haversine_samePointIsZero() {
        assertEquals(0.0, CarLogic.haversineKm(-26.2, 28.0, -26.2, 28.0), 1e-9)
    }

    @Test
    fun formatKm_underTenHasOneDecimal() {
        assertEquals("0.4 km", CarLogic.formatKm(0.44))
        assertEquals("9.0 km", CarLogic.formatKm(9.0))
    }

    @Test
    fun formatKm_tenAndOverIsWhole() {
        assertEquals("12 km", CarLogic.formatKm(12.4))
        assertEquals("10 km", CarLogic.formatKm(10.0))
    }

    @Test
    fun formatKm_nullIsDash() {
        assertEquals("—", CarLogic.formatKm(null))
    }

    @Test
    fun formatElapsed_minutesAndHours() {
        assertEquals("0m", CarLogic.formatElapsed(30))
        assertEquals("8m", CarLogic.formatElapsed(8 * 60L))
        assertEquals("59m", CarLogic.formatElapsed(59 * 60L + 59))
        assertEquals("1h 00m", CarLogic.formatElapsed(3600))
        assertEquals("1h 05m", CarLogic.formatElapsed(65 * 60L))
        assertEquals("2h 30m", CarLogic.formatElapsed(9000))
        assertEquals("0m", CarLogic.formatElapsed(-10))
    }

    @Test
    fun formatRegistration_uppercasesAndTrims() {
        assertEquals("CZK408EC", CarLogic.formatRegistration(" czk408ec "))
        assertEquals("", CarLogic.formatRegistration("  "))
        assertEquals("", CarLogic.formatRegistration(null))
    }

    @Test
    fun formatVehicleLabel_uppercasesPlateOnly() {
        assertEquals("Jeep · CZK408EC", CarLogic.formatVehicleLabel("Jeep · czk408ec"))
        assertEquals("Toyota Hilux · CA 123", CarLogic.formatVehicleLabel("Toyota Hilux · ca 123"))
        assertEquals("CZK408EC", CarLogic.formatVehicleLabel("czk408ec"))
        assertEquals("On foot", CarLogic.formatVehicleLabel("On foot"))
        assertEquals("Golf cart", CarLogic.formatVehicleLabel("Golf cart"))
        assertEquals("Bicycle", CarLogic.formatVehicleLabel("Bicycle"))
        assertEquals("", CarLogic.formatVehicleLabel(null))
    }

    @Test
    fun formatClock_is24HourInZone() {
        assertEquals("21:04", CarLogic.formatClock(start, johannesburg))
        assertEquals("19:04", CarLogic.formatClock(start, TimeZone.getTimeZone("UTC")))
    }

    @Test
    fun formatDate_isWeekdayDayMonth() {
        assertEquals("Wed 11 Nov", CarLogic.formatDate(start, johannesburg))
    }

    @Test
    fun patrolStats_onPatrol() {
        val now = start + 65 * 60_000L
        assertEquals("21:04 · 1h 05m · 12.4 km", CarLogic.formatPatrolStats(true, start, now, 12.4, johannesburg))
    }

    @Test
    fun patrolStats_onPatrolWithoutKmShowsZero() {
        assertEquals("21:04 · 8m · 0.0 km", CarLogic.formatPatrolStats(true, start, start + 8 * 60_000L, null, johannesburg))
    }

    @Test
    fun patrolStats_idleIsNull() {
        assertNull(CarLogic.formatPatrolStats(false, null, start, null, johannesburg))
        assertNull(CarLogic.formatPatrolStats(false, start, start, 3.0, johannesburg))
        assertNull(CarLogic.formatPatrolStats(true, null, start, 3.0, johannesburg))
    }

    @Test
    fun formatDateTime_isDateDotClock() {
        assertEquals("Wed 11 Nov · 21:04", CarLogic.formatDateTime(start, johannesburg))
    }

    @Test
    fun formatTimeRange_sameDayAndAcrossMidnight() {
        assertEquals("Wed 11 Nov · 21:04–21:12", CarLogic.formatTimeRange(start, start + 8 * 60_000L, johannesburg))
        assertEquals(
            "Wed 11 Nov · 21:04 – Thu 12 Nov · 00:04",
            CarLogic.formatTimeRange(start, start + 3 * 3_600_000L, johannesburg),
        )
    }

    private fun pt(lat: Double, lng: Double) = LatLngAcc(lat, lng, null)

    @Test
    fun pickMapAnchor_liveFixWinsOverEverything() {
        val live = pt(-26.2, 28.0)
        assertEquals(live, CarLogic.pickMapAnchor(live, pt(-30.0, 30.0), pt(-31.0, 31.0), pt(-33.0, 18.0)))
    }

    @Test
    fun pickMapAnchor_fallbackOrder() {
        val server = pt(-30.0, 30.0)
        val snap = pt(-31.0, 31.0)
        val org = pt(-33.0, 18.0)
        assertEquals(server, CarLogic.pickMapAnchor(null, server, snap, org))
        assertEquals(snap, CarLogic.pickMapAnchor(null, null, snap, org))
        assertEquals(org, CarLogic.pickMapAnchor(null, null, null, org))
    }

    @Test
    fun pickMapAnchor_invalidValuesAreSkipped() {
        val org = pt(-33.0, 18.0)
        assertEquals(org, CarLogic.pickMapAnchor(pt(95.0, 10.0), pt(Double.NaN, 3.0), pt(0.0, 0.0), org))
        assertEquals(org, CarLogic.pickMapAnchor(pt(10.0, 200.0), pt(Double.POSITIVE_INFINITY, 1.0), pt(-91.0, 0.0), org))
    }

    @Test
    fun pickMapAnchor_nothingKnownIsNull() {
        assertNull(CarLogic.pickMapAnchor(null, null, null, null))
        assertNull(CarLogic.pickMapAnchor(null, null, pt(0.0, 0.0), pt(Double.NaN, Double.NaN)))
    }

    @Test
    fun showNearby_needsSosOrCloseIncident() {
        assertFalse(CarLogic.showNearby(0, emptyList()))
        assertFalse(CarLogic.showNearby(0, listOf(5.1, 12.0)))
        assertTrue(CarLogic.showNearby(0, listOf(12.0, 5.0)))
        assertTrue(CarLogic.showNearby(0, listOf(null)))
        assertTrue(CarLogic.showNearby(1, emptyList()))
    }

    @Test
    fun vehicleIconKey_byType() {
        assertEquals("walk", CarLogic.vehicleIconKey("on_foot", null))
        assertEquals("walk", CarLogic.vehicleIconKey("horse", "Bessie"))
        assertEquals("bike", CarLogic.vehicleIconKey("bicycle", "Trek"))
        assertEquals("bike", CarLogic.vehicleIconKey("electric_scooter", null))
        assertEquals("motorcycle", CarLogic.vehicleIconKey("motorcycle", "Honda"))
        assertEquals("car", CarLogic.vehicleIconKey("car", "Toyota Hilux"))
        assertEquals("car", CarLogic.vehicleIconKey("truck", "Bakkie"))
        assertEquals("car", CarLogic.vehicleIconKey("golf_cart", null))
    }

    @Test
    fun vehicleIconKey_byLabelWhenTypeMissing() {
        assertEquals("walk", CarLogic.vehicleIconKey(null, "On foot"))
        assertEquals("walk", CarLogic.vehicleIconKey("", "on foot"))
        assertEquals("walk", CarLogic.vehicleIconKey("car", "On foot"))
        assertEquals("bike", CarLogic.vehicleIconKey(null, "Bicycle"))
        assertEquals("bike", CarLogic.vehicleIconKey(null, "Mountain bike"))
        assertEquals("motorcycle", CarLogic.vehicleIconKey(null, "Motorbike"))
        assertEquals("motorcycle", CarLogic.vehicleIconKey(null, "Motor bike"))
        assertEquals("car", CarLogic.vehicleIconKey(null, "Toyota Corolla"))
        assertEquals("car", CarLogic.vehicleIconKey(null, null))
    }
    @Test
    fun severity_mapping() {
        assertEquals(Severity.CRITICAL, CarLogic.severityFor("SOS"))
        assertEquals(Severity.CRITICAL, CarLogic.severityFor("sos"))
        assertEquals(Severity.HIGH, CarLogic.severityFor("Theft"))
        assertEquals(Severity.HIGH, CarLogic.severityFor("Suspicious Vehicle"))
        assertEquals(Severity.HIGH, CarLogic.severityFor("  suspicious activity "))
        assertEquals(Severity.LOW, CarLogic.severityFor("Vandalism"))
        assertEquals(Severity.LOW, CarLogic.severityFor("Noise Complaint"))
        assertEquals(Severity.LOW, CarLogic.severityFor("Other"))
        assertEquals(Severity.LOW, CarLogic.severityFor("something new"))
        assertEquals(Severity.LOW, CarLogic.severityFor(null))
    }

    @Test
    fun shouldAutoRefresh_edges() {
        assertTrue(CarLogic.shouldAutoRefresh(0, 1_000))
        assertFalse(CarLogic.shouldAutoRefresh(1_000, 15_999))
        assertTrue(CarLogic.shouldAutoRefresh(1_000, 16_000))
        assertTrue(CarLogic.shouldAutoRefresh(1_000, 5_000, minMs = 3_000))
    }

    @Test
    fun needsTokenRefresh_edges() {
        assertTrue(CarLogic.needsTokenRefresh(0, 100))
        assertFalse(CarLogic.needsTokenRefresh(1_000, 979))
        assertTrue(CarLogic.needsTokenRefresh(1_000, 980))
        assertTrue(CarLogic.needsTokenRefresh(1_000, 2_000))
        assertFalse(CarLogic.needsTokenRefresh(1_000, 900, skewSec = 50))
        assertTrue(CarLogic.needsTokenRefresh(1_000, 950, skewSec = 50))
    }

    @Test
    fun displayKm_matchingStartsTakeTheLarger() {
        assertEquals(5.0, CarLogic.displayKm(4.0, 5.0, start + 30_000, start)!!, 1e-9)
        assertEquals(6.0, CarLogic.displayKm(6.0, 5.0, start, start)!!, 1e-9)
        assertEquals(5.0, CarLogic.displayKm(null, 5.0, start, start)!!, 1e-9)
    }

    @Test
    fun displayKm_mismatchedStartsUseServer() {
        assertEquals(4.0, CarLogic.displayKm(4.0, 9.0, start + 61_000, start)!!, 1e-9)
        assertEquals(4.0, CarLogic.displayKm(4.0, 9.0, 0, start)!!, 1e-9)
        assertNull(CarLogic.displayKm(null, 9.0, start + 120_000, start))
        assertEquals(4.0, CarLogic.displayKm(4.0, null, start, start)!!, 1e-9)
    }

    @Test
    fun rowSignature_changesWithTitleOrRows() {
        val base = CarLogic.rowSignature("Watchman", listOf("A", "B"))
        assertEquals(base, CarLogic.rowSignature("Watchman", listOf("A", "B")))
        assertNotEquals(base, CarLogic.rowSignature("Watchman", listOf("A", "C")))
        assertNotEquals(base, CarLogic.rowSignature("Watchman", listOf("A")))
        assertNotEquals(base, CarLogic.rowSignature("Other", listOf("A", "B")))
    }

    @Test
    fun timeAgo_buckets() {
        val now = 10_000_000_000L
        assertEquals("now", CarLogic.timeAgo(now - 30_000, now))
        assertEquals("now", CarLogic.timeAgo(now + 5_000, now))
        assertEquals("4 min ago", CarLogic.timeAgo(now - 4 * 60_000L, now))
        assertEquals("59 min ago", CarLogic.timeAgo(now - 59 * 60_000L, now))
        assertEquals("2 h ago", CarLogic.timeAgo(now - 2 * 3_600_000L - 5_000, now))
    }

    @Test
    fun parseIsoMs_postgresFormats() {
        assertEquals(start, CarLogic.parseIsoMs("2026-11-11T19:04:00+00:00"))
        assertEquals(start, CarLogic.parseIsoMs("2026-11-11T19:04:00Z"))
        assertEquals(start, CarLogic.parseIsoMs("2026-11-11T21:04:00+02:00"))
        assertEquals(start, CarLogic.parseIsoMs("2026-11-11T21:04:00+02"))
        assertEquals(start + 12_345, CarLogic.parseIsoMs("2026-11-11T19:04:12.345678+00:00"))
        assertNull(CarLogic.parseIsoMs("not a date"))
        assertNull(CarLogic.parseIsoMs(null))
        assertNull(CarLogic.parseIsoMs(""))
    }
}
