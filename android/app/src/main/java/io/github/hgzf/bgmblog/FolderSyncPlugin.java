package io.github.hgzf.bgmblog;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "FolderSync")
public class FolderSyncPlugin extends Plugin {

    private static final String PREFS_NAME = "folder_sync";
    private static final String PREF_TREE_URI = "tree_uri";
    private static final long MAX_SNAPSHOT_BYTES = 64L * 1024L * 1024L;
    private static final Pattern SNAPSHOT_NAME = Pattern.compile("^bgm-blog-sync-[a-z0-9-]{6,80}\\.json$", Pattern.CASE_INSENSITIVE);

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private Uri storedTreeUri() {
        String value = preferences().getString(PREF_TREE_URI, "");
        return value.isBlank() ? null : Uri.parse(value);
    }

    private String displayPath(Uri uri) {
        try {
            return Uri.decode(DocumentsContract.getTreeDocumentId(uri));
        } catch (Exception ignored) {
            return uri.toString();
        }
    }

    private Uri childDocumentsUri(Uri treeUri) {
        String documentId = DocumentsContract.getTreeDocumentId(treeUri);
        return DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, documentId);
    }

    private Uri findChild(Uri treeUri, String displayName) {
        ContentResolver resolver = getContext().getContentResolver();
        String[] projection = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME
        };
        try (Cursor cursor = resolver.query(childDocumentsUri(treeUri), projection, null, null, null)) {
            if (cursor == null) return null;
            while (cursor.moveToNext()) {
                if (displayName.equals(cursor.getString(1))) {
                    return DocumentsContract.buildDocumentUriUsingTree(treeUri, cursor.getString(0));
                }
            }
        }
        return null;
    }

    private byte[] readLimited(InputStream stream) throws Exception {
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16 * 1024];
            long total = 0;
            int read;
            while ((read = input.read(buffer)) >= 0) {
                total += read;
                if (total > MAX_SNAPSHOT_BYTES) throw new IllegalArgumentException("同步快照超过 64 MB 安全上限。");
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }
    }

    @PluginMethod
    public void getInfo(PluginCall call) {
        Uri treeUri = storedTreeUri();
        JSObject result = new JSObject();
        result.put("ok", true);
        result.put("supported", true);
        result.put("configured", treeUri != null);
        result.put("folderPath", treeUri == null ? "" : displayPath(treeUri));
        call.resolve(result);
    }

    @PluginMethod
    public void chooseFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION |
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION |
            Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        );
        startActivityForResult(call, intent, "folderPickerResult");
    }

    @ActivityCallback
    private void folderPickerResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("未选择同步文件夹。");
            return;
        }
        Uri treeUri = result.getData().getData();
        getContext().getContentResolver().takePersistableUriPermission(
            treeUri,
            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        );
        preferences().edit().putString(PREF_TREE_URI, treeUri.toString()).apply();
        JSObject response = new JSObject();
        response.put("ok", true);
        response.put("supported", true);
        response.put("configured", true);
        response.put("folderPath", displayPath(treeUri));
        call.resolve(response);
    }

    @PluginMethod
    public void readSnapshots(PluginCall call) {
        Uri treeUri = storedTreeUri();
        if (treeUri == null) {
            call.reject("尚未选择同步文件夹。");
            return;
        }
        try {
            ContentResolver resolver = getContext().getContentResolver();
            String[] projection = {
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE
            };
            JSArray snapshots = new JSArray();
            try (Cursor cursor = resolver.query(childDocumentsUri(treeUri), projection, null, null, null)) {
                if (cursor == null) throw new IllegalStateException("无法读取同步文件夹。");
                while (cursor.moveToNext() && snapshots.length() < 24) {
                    String documentId = cursor.getString(0);
                    String displayName = cursor.getString(1);
                    String mimeType = cursor.getString(2);
                    if (!SNAPSHOT_NAME.matcher(displayName).matches()) continue;
                    if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mimeType)) continue;
                    Uri documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId);
                    try (InputStream stream = resolver.openInputStream(documentUri)) {
                        if (stream == null) continue;
                        String content = new String(readLimited(stream), StandardCharsets.UTF_8);
                        JSObject snapshot = new JSObject();
                        snapshot.put("name", displayName);
                        snapshot.put("content", content);
                        snapshots.put(snapshot);
                    } catch (Exception ignored) {
                        // An incomplete file may still be syncing.
                    }
                }
            }
            JSObject response = new JSObject();
            response.put("ok", true);
            response.put("configured", true);
            response.put("folderPath", displayPath(treeUri));
            response.put("snapshots", snapshots);
            call.resolve(response);
        } catch (Exception error) {
            call.reject(error.getMessage(), error);
        }
    }

    @PluginMethod
    public void writeSnapshot(PluginCall call) {
        Uri treeUri = storedTreeUri();
        if (treeUri == null) {
            call.reject("尚未选择同步文件夹。");
            return;
        }
        String filename = call.getString("filename", "");
        String content = call.getString("content", "");
        if (!SNAPSHOT_NAME.matcher(filename).matches()) {
            call.reject("同步快照文件名无效。");
            return;
        }
        if (content.getBytes(StandardCharsets.UTF_8).length > MAX_SNAPSHOT_BYTES) {
            call.reject("同步快照超过 64 MB 安全上限。");
            return;
        }
        try {
            ContentResolver resolver = getContext().getContentResolver();
            Uri documentUri = findChild(treeUri, filename);
            if (documentUri == null) {
                Uri treeDocumentUri = DocumentsContract.buildDocumentUriUsingTree(
                    treeUri,
                    DocumentsContract.getTreeDocumentId(treeUri)
                );
                documentUri = DocumentsContract.createDocument(
                    resolver,
                    treeDocumentUri,
                    "application/json",
                    filename
                );
            }
            if (documentUri == null) throw new IllegalStateException("无法在同步文件夹中创建快照。");
            try (OutputStream stream = resolver.openOutputStream(documentUri, "wt")) {
                if (stream == null) throw new IllegalStateException("无法写入同步快照。");
                stream.write(content.getBytes(StandardCharsets.UTF_8));
            }
            JSObject response = new JSObject();
            response.put("ok", true);
            response.put("configured", true);
            response.put("folderPath", displayPath(treeUri));
            response.put("path", documentUri.toString());
            call.resolve(response);
        } catch (Exception error) {
            call.reject(error.getMessage(), error);
        }
    }

    @PluginMethod
    public void openFolder(PluginCall call) {
        Uri treeUri = storedTreeUri();
        if (treeUri == null) {
            call.reject("尚未选择同步文件夹。");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(treeUri, DocumentsContract.Document.MIME_TYPE_DIR);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            getActivity().startActivity(intent);
            JSObject response = new JSObject();
            response.put("ok", true);
            response.put("folderPath", displayPath(treeUri));
            call.resolve(response);
        } catch (Exception error) {
            call.reject("无法打开同步文件夹。", error);
        }
    }
}
