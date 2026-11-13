package app.dot.opendots

import android.app.Application
import app.dot.opendots.data.OpenDotsClient
import app.dot.opendots.data.PrefsSessionStore
import app.dot.opendots.data.SessionStore
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.crossfade

class OpenDotsApp : Application(), SingletonImageLoader.Factory {
    val store: SessionStore by lazy { PrefsSessionStore(this) }
    val client: OpenDotsClient by lazy { OpenDotsClient(store) }

    /** Attachments live behind the session: images are fetched with the same HTTP client (and cookie) as the API. */
    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader.Builder(context)
            .components { add(OkHttpNetworkFetcherFactory(callFactory = { client.http })) }
            .crossfade(true)
            .build()
}
