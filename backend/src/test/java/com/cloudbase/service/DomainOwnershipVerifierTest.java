package com.cloudbase.service;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The real JNDI DNS lookup against a local UDP responder: only the exact challenge value proves ownership. */
class DomainOwnershipVerifierTest {

    private DatagramSocket socket;
    private Thread server;

    @AfterEach
    void stop() {
        if (socket != null) socket.close();
    }

    private DomainOwnershipVerifier verifierServing(Map<String, List<String>> records) throws Exception {
        socket = new DatagramSocket(0, InetAddress.getLoopbackAddress());
        server = new Thread(() -> {
            byte[] buf = new byte[512];
            while (!socket.isClosed()) {
                try {
                    DatagramPacket in = new DatagramPacket(buf, buf.length);
                    socket.receive(in);
                    byte[] reply = answer(in.getData(), in.getLength(), records);
                    socket.send(new DatagramPacket(reply, reply.length, in.getSocketAddress()));
                } catch (Exception e) {
                    return;
                }
            }
        });
        server.setDaemon(true);
        server.start();
        return new DomainOwnershipVerifier("dns://127.0.0.1:" + socket.getLocalPort());
    }

    /** Minimal DNS responder: answers TXT questions from {@code records}; NXDOMAIN otherwise. */
    static byte[] answer(byte[] q, int len, Map<String, List<String>> records) {
        int i = 12;
        StringBuilder name = new StringBuilder();
        while (q[i] != 0) {
            int n = q[i++];
            if (name.length() > 0) name.append('.');
            name.append(new String(q, i, n, StandardCharsets.US_ASCII));
            i += n;
        }
        int questionEnd = i + 5;
        List<String> values = records.getOrDefault(name.toString().toLowerCase(), List.of());
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(q[0]);
        out.write(q[1]);
        out.write(0x81);
        out.write(values.isEmpty() ? 0x83 : 0x80);
        out.writeBytes(new byte[]{0, 1, 0, (byte) values.size(), 0, 0, 0, 0});
        out.write(q, 12, questionEnd - 12);
        for (String v : values) {
            byte[] txt = v.getBytes(StandardCharsets.US_ASCII);
            out.writeBytes(new byte[]{(byte) 0xC0, 12, 0, 16, 0, 1, 0, 0, 0, 60, 0, (byte) (txt.length + 1), (byte) txt.length});
            out.writeBytes(txt);
        }
        return out.toByteArray();
    }

    @Test
    void theExactChallengeValueProvesOwnership() throws Exception {
        DomainOwnershipVerifier v = verifierServing(Map.of("_cloudbase-challenge.app.example.test",
                List.of("v=spf1 -all", "cloudbase-verify=abc123")));
        assertTrue(v.proves("app.example.test", "abc123"));
    }

    @Test
    void anotherTokenAMissingRecordOrAPrefixOnlyMatchDoNotProveIt() throws Exception {
        DomainOwnershipVerifier v = verifierServing(Map.of("_cloudbase-challenge.app.example.test",
                List.of("cloudbase-verify=someone-else", "cloudbase-verify=abc1234")));
        assertFalse(v.proves("app.example.test", "abc123"), "another tenant's token");
        assertFalse(v.proves("other.example.test", "abc123"), "no record");
    }
    @Test
    void anUnreachableDnsServerIsNotProofAndFailsWithinItsTimeout() throws Exception {
        int closed;
        try (DatagramSocket s = new DatagramSocket(0, InetAddress.getLoopbackAddress())) {
            closed = s.getLocalPort();
        }
        DomainOwnershipVerifier v = new DomainOwnershipVerifier("dns://127.0.0.1:" + closed);
        long started = System.nanoTime();
        assertFalse(v.proves("app.example.test", "abc123"));
        assertTrue(System.nanoTime() - started < 20_000_000_000L, "bounded by the lookup timeout");
    }
}
