package com.watchman.app.car

import androidx.annotation.StringRes
import com.watchman.app.R

/** Maps a failure to one of the short friendly strings in car_strings.xml. Never raw errors. */
object CarMessages {
    @StringRes
    fun forFail(kind: FailKind): Int = when (kind) {
        FailKind.SIGNED_OUT -> R.string.car_msg_signed_out
        FailKind.NOT_PATROLLER -> R.string.car_msg_not_patroller
        FailKind.NO_ORG -> R.string.car_msg_no_org
        FailKind.OFFLINE -> R.string.car_msg_offline
        FailKind.SERVER_OUTDATED -> R.string.car_msg_server_outdated
        FailKind.UNKNOWN -> R.string.car_msg_generic
    }

    /** Maps the server's "status" field of a non-success reply; null when it is not a known failure. */
    fun failForStatus(status: String?): FailKind? = when (status) {
        "signed_out" -> FailKind.SIGNED_OUT
        "not_patroller", "not_allowed" -> FailKind.NOT_PATROLLER
        "no_org" -> FailKind.NO_ORG
        else -> null
    }
}
