package com.tukaka.bridge;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.sql.Blob;
import java.sql.Clob;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicLong;

/**
 * TUKAKA Database Studio JDBC köprüsü.
 *
 * Node.js servisi bu süreci başlatır ve stdin/stdout üzerinden satır başına bir
 * JSON mesajıyla konuşur:
 *
 *   istek:  {"id": 1, "op": "query", ...}
 *   yanıt:  {"id": 1, "ok": true, "result": {...}}
 *           {"id": 1, "ok": false, "error": {"message": "...", "sqlState": "...", "code": 0}}
 *
 * İşlemler: open, query, batch, cancel, close, ping. İstekler paralel işlenir.
 * stdin kapanınca (servis kapandı) süreç sonlanır.
 */
public final class JdbcBridge {
    static final String VERSION = "1";

    /** Hücre başına okunacak en fazla LOB uzunluğu (karakter/bayt). */
    private static final int MAX_LOB = 1_048_576;

    private static final Map<String, DataSource> SOURCES = new ConcurrentHashMap<>();
    private static final Map<String, Statement> RUNNING = new ConcurrentHashMap<>();
    private static final AtomicLong HANDLES = new AtomicLong();
    private static final Object OUTPUT_LOCK = new Object();
    private static PrintStream out;

    private JdbcBridge() {}

    public static void main(String[] args) throws Exception {
        out = new PrintStream(System.out, true, "UTF-8");
        // Sürücülerin kendi loglarını stdout'a yazması protokolü bozmasın.
        System.setOut(System.err);

        ExecutorService workers = Executors.newCachedThreadPool(runnable -> {
            Thread thread = new Thread(runnable, "tukaka-jdbc");
            thread.setDaemon(true);
            return thread;
        });

        send(event("ready"));

        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        String line;
        while ((line = in.readLine()) != null) {
            if (line.trim().isEmpty()) continue;
            final String request = line;
            workers.submit(() -> handle(request));
        }

        for (DataSource source : SOURCES.values()) source.close();
        System.exit(0);
    }

    private static Map<String, Object> event(String name) {
        Map<String, Object> message = new LinkedHashMap<>();
        message.put("event", name);
        message.put("version", VERSION);
        message.put("java", System.getProperty("java.version"));
        return message;
    }

    @SuppressWarnings("unchecked")
    private static void handle(String line) {
        Object id = null;
        Map<String, Object> response = new LinkedHashMap<>();

        try {
            Map<String, Object> request = (Map<String, Object>) Json.parse(line);
            id = request.get("id");
            response.put("id", id);
            response.put("ok", true);
            response.put("result", dispatch(request));
        } catch (Throwable error) {
            response.clear();
            response.put("id", id);
            response.put("ok", false);
            response.put("error", describe(error));
        }

        send(response);
    }

    private static Map<String, Object> describe(Throwable error) {
        Map<String, Object> details = new LinkedHashMap<>();
        String message = error.getMessage();
        details.put("message", message != null ? message : error.getClass().getName());
        if (error instanceof SQLException) {
            details.put("sqlState", ((SQLException) error).getSQLState());
            details.put("code", ((SQLException) error).getErrorCode());
        }
        return details;
    }

    private static void send(Object message) {
        String json = Json.stringify(message);
        synchronized (OUTPUT_LOCK) {
            out.println(json);
        }
    }

    // ------------------------------------------------------------------ ops

    @SuppressWarnings("unchecked")
    private static Object dispatch(Map<String, Object> request) throws Exception {
        String op = String.valueOf(request.get("op"));

        switch (op) {
            case "ping": {
                return event("pong");
            }
            case "open": {
                Properties properties = new Properties();
                Object props = request.get("properties");
                if (props instanceof Map) {
                    for (Map.Entry<String, Object> entry : ((Map<String, Object>) props).entrySet()) {
                        properties.setProperty(entry.getKey(), String.valueOf(entry.getValue()));
                    }
                }
                if (request.get("user") != null) properties.setProperty("user", String.valueOf(request.get("user")));
                if (request.get("password") != null) properties.setProperty("password", String.valueOf(request.get("password")));

                String driver = (String) request.get("driverClass");
                if (driver != null) Class.forName(driver);

                DataSource source = new DataSource(
                    String.valueOf(request.get("url")),
                    properties,
                    intValue(request.get("poolSize"), 5)
                );

                // Bağlantı bilgilerini hemen doğrula.
                Connection connection = source.acquire();
                source.release(connection, false);

                String handle = "s" + HANDLES.incrementAndGet();
                SOURCES.put(handle, source);

                Map<String, Object> result = new LinkedHashMap<>();
                result.put("handle", handle);
                return result;
            }
            case "query": {
                return query(request);
            }
            case "batch": {
                return batch(request);
            }
            case "cancel": {
                Statement statement = RUNNING.get(String.valueOf(request.get("queryId")));
                Map<String, Object> result = new LinkedHashMap<>();
                if (statement != null) statement.cancel();
                result.put("cancelled", statement != null);
                return result;
            }
            case "close": {
                DataSource source = SOURCES.remove(String.valueOf(request.get("handle")));
                if (source != null) source.close();
                return new LinkedHashMap<String, Object>();
            }
            default:
                throw new IllegalArgumentException("Unknown operation: " + op);
        }
    }

    private static DataSource source(Map<String, Object> request) {
        DataSource source = SOURCES.get(String.valueOf(request.get("handle")));
        if (source == null) throw new IllegalStateException("Connection handle is closed.");
        return source;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> query(Map<String, Object> request) throws Exception {
        DataSource source = source(request);
        String sql = String.valueOf(request.get("sql"));
        List<Object> parameters = request.get("params") instanceof List
            ? (List<Object>) request.get("params")
            : new ArrayList<>();
        int maxRows = intValue(request.get("maxRows"), 1000);
        int timeoutSeconds = intValue(request.get("timeoutSeconds"), 0);
        String queryId = request.get("queryId") != null ? String.valueOf(request.get("queryId")) : null;

        Connection connection = source.acquire();
        boolean broken = false;
        Statement statement = null;

        try {
            boolean hasResultSet;

            if (parameters.isEmpty()) {
                statement = connection.createStatement();
                prepare(statement, maxRows, timeoutSeconds, queryId);
                hasResultSet = statement.execute(sql);
            } else {
                PreparedStatement prepared = connection.prepareStatement(sql);
                statement = prepared;
                bind(prepared, parameters);
                prepare(statement, maxRows, timeoutSeconds, queryId);
                hasResultSet = prepared.execute();
            }

            Map<String, Object> last = null;
            long affected = 0;
            int statementCount = 0;

            while (true) {
                if (hasResultSet) {
                    statementCount++;
                    try (ResultSet resultSet = statement.getResultSet()) {
                        last = readResultSet(resultSet, maxRows);
                    }
                } else {
                    int updateCount = statement.getUpdateCount();
                    if (updateCount == -1) break;
                    statementCount++;
                    affected += updateCount;
                }
                hasResultSet = statement.getMoreResults();
            }

            Map<String, Object> result = last != null ? last : new LinkedHashMap<>();
            if (last == null) {
                result.put("columns", new ArrayList<>());
                result.put("rows", new ArrayList<>());
                result.put("truncated", false);
            }
            result.put("affected", affected);
            result.put("statementCount", Math.max(statementCount, 1));
            return result;
        } catch (SQLException error) {
            broken = isConnectionError(error);
            throw error;
        } finally {
            if (queryId != null) RUNNING.remove(queryId);
            if (statement != null) {
                try { statement.close(); } catch (SQLException ignored) { /* kapanırken */ }
            }
            source.release(connection, broken);
        }
    }

    private static void prepare(Statement statement, int maxRows, int timeoutSeconds, String queryId) throws SQLException {
        // Fazlası veritabanından hiç alınmaz; bir fazlası kesildiğini anlamak için.
        statement.setMaxRows(maxRows + 1);
        if (timeoutSeconds > 0) statement.setQueryTimeout(timeoutSeconds);
        if (queryId != null) RUNNING.put(queryId, statement);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> batch(Map<String, Object> request) throws Exception {
        DataSource source = source(request);
        List<Object> statements = (List<Object>) request.get("statements");

        Connection connection = source.acquire();
        boolean broken = false;

        try {
            connection.setAutoCommit(false);
            List<Object> affected = new ArrayList<>();

            for (int i = 0; i < statements.size(); i++) {
                Map<String, Object> item = (Map<String, Object>) statements.get(i);
                List<Object> parameters = item.get("params") instanceof List
                    ? (List<Object>) item.get("params")
                    : new ArrayList<>();

                try (PreparedStatement prepared = connection.prepareStatement(String.valueOf(item.get("sql")))) {
                    bind(prepared, parameters);
                    int count = prepared.executeUpdate();
                    Object expected = item.get("expectedRows");

                    if (expected != null && count != intValue(expected, count)) {
                        throw new SQLException(
                            "Statement " + (i + 1) + " affected " + count + " row(s) instead of " + expected
                                + ". The row may have been changed or deleted by someone else. No changes were saved."
                        );
                    }
                    affected.add(count);
                }
            }

            connection.commit();

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("affected", affected);
            return result;
        } catch (SQLException error) {
            try { connection.rollback(); } catch (SQLException ignored) { broken = true; }
            broken = broken || isConnectionError(error);
            throw error;
        } finally {
            source.release(connection, broken);
        }
    }

    private static void bind(PreparedStatement statement, List<Object> parameters) throws SQLException {
        for (int i = 0; i < parameters.size(); i++) {
            Object value = parameters.get(i);
            if (value instanceof BigDecimal) statement.setBigDecimal(i + 1, (BigDecimal) value);
            else statement.setObject(i + 1, value);
        }
    }

    private static Map<String, Object> readResultSet(ResultSet resultSet, int maxRows) throws SQLException {
        ResultSetMetaData meta = resultSet.getMetaData();
        int count = meta.getColumnCount();
        List<Object> columns = new ArrayList<>();
        for (int i = 1; i <= count; i++) columns.add(meta.getColumnLabel(i));

        List<Object> rows = new ArrayList<>();
        boolean truncated = false;

        while (resultSet.next()) {
            if (rows.size() >= maxRows) { truncated = true; break; }
            Map<String, Object> row = new LinkedHashMap<>();
            for (int i = 1; i <= count; i++) {
                row.put(String.valueOf(columns.get(i - 1)), convert(resultSet.getObject(i)));
            }
            rows.add(row);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("columns", columns);
        result.put("rows", rows);
        result.put("truncated", truncated);
        return result;
    }

    /** JDBC değerini JSON'a uygun türe çevirir. */
    static Object convert(Object value) throws SQLException {
        if (value == null || value instanceof String || value instanceof Boolean) return value;
        if (value instanceof Integer || value instanceof Long || value instanceof Short || value instanceof Byte) return value;
        if (value instanceof Double || value instanceof Float) return value;
        if (value instanceof BigDecimal) {
            BigDecimal decimal = (BigDecimal) value;
            // JavaScript'te kesin gösterilemeyen sayılar metin olarak gider.
            return decimal.precision() <= 15 ? decimal : decimal.toPlainString();
        }
        if (value instanceof BigInteger) return value.toString();
        if (value instanceof Timestamp) return ((Timestamp) value).toLocalDateTime().toString();
        if (value instanceof java.sql.Date || value instanceof java.sql.Time) return value.toString();
        if (value instanceof java.util.Date) return new Timestamp(((java.util.Date) value).getTime()).toLocalDateTime().toString();
        if (value instanceof byte[]) return hex((byte[]) value);
        if (value instanceof Clob) {
            Clob clob = (Clob) value;
            return clob.getSubString(1, (int) Math.min(clob.length(), MAX_LOB));
        }
        if (value instanceof Blob) {
            Blob blob = (Blob) value;
            return hex(blob.getBytes(1, (int) Math.min(blob.length(), MAX_LOB)));
        }
        return value.toString();
    }

    private static String hex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2 + 2).append("0x");
        for (byte b : bytes) sb.append(String.format("%02X", b));
        return sb.toString();
    }

    private static boolean isConnectionError(SQLException error) {
        String state = error.getSQLState();
        return state != null && state.startsWith("08");
    }

    private static int intValue(Object value, int fallback) {
        if (value instanceof Number) return ((Number) value).intValue();
        if (value instanceof String) {
            try { return Integer.parseInt((String) value); } catch (NumberFormatException ignored) { return fallback; }
        }
        return fallback;
    }

    // ------------------------------------------------------------ data source

    /** Basit bağlantı havuzu (en fazla `size` eşzamanlı bağlantı). */
    static final class DataSource {
        private final String url;
        private final Properties properties;
        private final Semaphore permits;
        private final Deque<Connection> idle = new ArrayDeque<>();

        DataSource(String url, Properties properties, int size) {
            this.url = url;
            this.properties = properties;
            this.permits = new Semaphore(Math.max(1, size));
        }

        Connection acquire() throws SQLException, InterruptedException {
            permits.acquire();
            try {
                while (true) {
                    Connection connection;
                    synchronized (idle) { connection = idle.pollFirst(); }
                    if (connection == null) return DriverManager.getConnection(url, properties);
                    if (isUsable(connection)) return connection;
                    closeQuietly(connection);
                }
            } catch (SQLException | RuntimeException error) {
                permits.release();
                throw error;
            }
        }

        void release(Connection connection, boolean broken) {
            try {
                if (broken || connection.isClosed()) {
                    closeQuietly(connection);
                    return;
                }
                if (!connection.getAutoCommit()) {
                    connection.rollback();
                    connection.setAutoCommit(true);
                }
                synchronized (idle) { idle.addFirst(connection); }
            } catch (SQLException error) {
                closeQuietly(connection);
            } finally {
                permits.release();
            }
        }

        void close() {
            synchronized (idle) {
                for (Connection connection : idle) closeQuietly(connection);
                idle.clear();
            }
        }

        private static boolean isUsable(Connection connection) {
            try {
                return !connection.isClosed() && connection.isValid(5);
            } catch (SQLException error) {
                return false;
            }
        }

        private static void closeQuietly(Connection connection) {
            try { connection.close(); } catch (SQLException ignored) { /* zaten kapalı */ }
        }
    }
}
