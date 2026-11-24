package com.tukaka.bridge;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Köprü protokolü için küçük, bağımlılıksız JSON okuyucu/yazıcı.
 * Nesneler LinkedHashMap, diziler ArrayList, sayılar Long/BigDecimal olarak okunur.
 */
final class Json {
    private final String text;
    private int index;

    private Json(String text) {
        this.text = text;
    }

    static Object parse(String text) {
        Json parser = new Json(text);
        parser.skipWhitespace();
        Object value = parser.readValue();
        parser.skipWhitespace();
        if (parser.index != text.length()) {
            throw parser.error("Unexpected trailing characters");
        }
        return value;
    }

    private IllegalArgumentException error(String message) {
        return new IllegalArgumentException(message + " at position " + index);
    }

    private void skipWhitespace() {
        while (index < text.length() && Character.isWhitespace(text.charAt(index))) {
            index++;
        }
    }

    private Object readValue() {
        if (index >= text.length()) throw error("Unexpected end of input");
        char c = text.charAt(index);
        switch (c) {
            case '{': return readObject();
            case '[': return readArray();
            case '"': return readString();
            case 't': expect("true"); return Boolean.TRUE;
            case 'f': expect("false"); return Boolean.FALSE;
            case 'n': expect("null"); return null;
            default: return readNumber();
        }
    }

    private void expect(String word) {
        if (!text.startsWith(word, index)) throw error("Expected " + word);
        index += word.length();
    }

    private Map<String, Object> readObject() {
        Map<String, Object> map = new LinkedHashMap<>();
        index++; // {
        skipWhitespace();
        if (peek() == '}') { index++; return map; }
        while (true) {
            skipWhitespace();
            String key = readString();
            skipWhitespace();
            if (peek() != ':') throw error("Expected ':'");
            index++;
            skipWhitespace();
            map.put(key, readValue());
            skipWhitespace();
            char c = peek();
            index++;
            if (c == '}') return map;
            if (c != ',') throw error("Expected ',' or '}'");
        }
    }

    private List<Object> readArray() {
        List<Object> list = new ArrayList<>();
        index++; // [
        skipWhitespace();
        if (peek() == ']') { index++; return list; }
        while (true) {
            skipWhitespace();
            list.add(readValue());
            skipWhitespace();
            char c = peek();
            index++;
            if (c == ']') return list;
            if (c != ',') throw error("Expected ',' or ']'");
        }
    }

    private char peek() {
        if (index >= text.length()) throw error("Unexpected end of input");
        return text.charAt(index);
    }

    private String readString() {
        if (peek() != '"') throw error("Expected string");
        index++;
        StringBuilder sb = new StringBuilder();
        while (true) {
            char c = peek();
            index++;
            if (c == '"') return sb.toString();
            if (c != '\\') { sb.append(c); continue; }
            char e = peek();
            index++;
            switch (e) {
                case '"': sb.append('"'); break;
                case '\\': sb.append('\\'); break;
                case '/': sb.append('/'); break;
                case 'b': sb.append('\b'); break;
                case 'f': sb.append('\f'); break;
                case 'n': sb.append('\n'); break;
                case 'r': sb.append('\r'); break;
                case 't': sb.append('\t'); break;
                case 'u':
                    if (index + 4 > text.length()) throw error("Bad unicode escape");
                    sb.append((char) Integer.parseInt(text.substring(index, index + 4), 16));
                    index += 4;
                    break;
                default: throw error("Bad escape");
            }
        }
    }

    private Object readNumber() {
        int start = index;
        while (index < text.length() && "+-0123456789.eE".indexOf(text.charAt(index)) >= 0) {
            index++;
        }
        String number = text.substring(start, index);
        if (number.isEmpty()) throw error("Unexpected character");
        if (number.matches("-?\\d{1,18}")) return Long.parseLong(number);
        return new BigDecimal(number);
    }

    // ---------------------------------------------------------------- writer

    static String stringify(Object value) {
        StringBuilder sb = new StringBuilder();
        write(sb, value);
        return sb.toString();
    }

    @SuppressWarnings("unchecked")
    private static void write(StringBuilder sb, Object value) {
        if (value == null) {
            sb.append("null");
        } else if (value instanceof String) {
            writeString(sb, (String) value);
        } else if (value instanceof Boolean) {
            sb.append(value.toString());
        } else if (value instanceof Number) {
            String number = value instanceof BigDecimal
                ? ((BigDecimal) value).toPlainString()
                : value.toString();
            // NaN/Infinity JSON'da yok.
            if (number.equals("NaN") || number.contains("Infinity")) writeString(sb, number);
            else sb.append(number);
        } else if (value instanceof Map) {
            sb.append('{');
            boolean first = true;
            for (Map.Entry<String, Object> entry : ((Map<String, Object>) value).entrySet()) {
                if (!first) sb.append(',');
                first = false;
                writeString(sb, entry.getKey());
                sb.append(':');
                write(sb, entry.getValue());
            }
            sb.append('}');
        } else if (value instanceof Iterable) {
            sb.append('[');
            boolean first = true;
            for (Object item : (Iterable<Object>) value) {
                if (!first) sb.append(',');
                first = false;
                write(sb, item);
            }
            sb.append(']');
        } else {
            writeString(sb, value.toString());
        }
    }

    private static void writeString(StringBuilder sb, String value) {
        sb.append('"');
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    // Kontrol karakterleri ve satır ayırıcılar (NDJSON bütünlüğü için).
                    if (c < 0x20 || c == ' ' || c == ' ') {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        sb.append('"');
    }
}
