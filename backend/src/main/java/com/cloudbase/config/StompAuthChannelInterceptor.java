package com.cloudbase.config;

import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.entity.UserEntity;
import com.cloudbase.model.UserRole;
import com.cloudbase.model.AccountStatus;
import com.cloudbase.repository.ServiceRepository;
import com.cloudbase.repository.UserRepository;
import com.cloudbase.security.JwtService;
import io.jsonwebtoken.Claims;
import org.springframework.lang.NonNull;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.stereotype.Component;

import java.security.Principal;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * STOMP CONNECT requires a session JWT. SUBSCRIBE is limited to services the user can see.
 */
@Component
public class StompAuthChannelInterceptor implements ChannelInterceptor {

    private static final Pattern TOPIC = Pattern.compile("^/topic/(deployments|logs)/([A-Za-z0-9_-]+)$");

    private final JwtService jwtService;
    private final UserRepository userRepository;
    private final ServiceRepository serviceRepository;
    /** Session id -> authentication from CONNECT; the broker's outbound messages carry only the session id. */
    private final java.util.Map<String, UsernamePasswordAuthenticationToken> sessions = new java.util.concurrent.ConcurrentHashMap<>();

    public StompAuthChannelInterceptor(
            JwtService jwtService,
            UserRepository userRepository,
            ServiceRepository serviceRepository
    ) {
        this.jwtService = jwtService;
        this.userRepository = userRepository;
        this.serviceRepository = serviceRepository;
    }

    @Override
    public Message<?> preSend(@NonNull Message<?> message, @NonNull MessageChannel channel) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (accessor == null || accessor.getCommand() == null) {
            return message;
        }
        if (StompCommand.CONNECT.equals(accessor.getCommand())) {
            UserEntity user = authenticate(accessor);
            UsernamePasswordAuthenticationToken auth = new UsernamePasswordAuthenticationToken(
                    user,
                    null,
                    List.of(new SimpleGrantedAuthority("ROLE_" + user.getRole().name()))
            );
            auth.setDetails(jwtService.getExpiration(sessionToken(accessor)));
            accessor.setUser(auth);
            if (accessor.getSessionId() != null) sessions.put(accessor.getSessionId(), auth);
            return message;
        }
        if (StompCommand.DISCONNECT.equals(accessor.getCommand()) && accessor.getSessionId() != null) {
            sessions.remove(accessor.getSessionId());
            return message;
        }
        if (StompCommand.SUBSCRIBE.equals(accessor.getCommand())) {
            authorizeSubscribe(accessor);
        }
        // This endpoint only streams server events; clients may not impersonate the event publisher.
        if (StompCommand.SEND.equals(accessor.getCommand())) {
            throw new IllegalArgumentException("Client event publishing is not supported");
        }
        return message;
    }

    private UserEntity authenticate(StompHeaderAccessor accessor) {
        String token = sessionToken(accessor);
        if (token == null || token.isBlank() || !jwtService.isTokenValid(token)) {
            throw new IllegalArgumentException("WebSocket authentication required");
        }
        Claims claims = jwtService.parseToken(token);
        String purpose = claims.get("purpose", String.class);
        if (purpose != null && !purpose.isBlank()) {
            throw new IllegalArgumentException("WebSocket authentication required");
        }
        return currentUser(claims.getSubject());
    }

    private static String sessionToken(StompHeaderAccessor accessor) {
        String header = firstHeader(accessor, "Authorization");
        if (header == null || header.isBlank()) {
            header = firstHeader(accessor, "authorization");
        }
        String token = firstHeader(accessor, "token");
        if (header != null && header.startsWith("Bearer ")) {
            token = header.substring(7).trim();
        }
        return token;
    }

    private UserEntity currentUser(String id) {
        UserEntity user = userRepository.findById(id).orElse(null);
        if (user == null || user.getAccountStatus() != AccountStatus.ACTIVE || !user.isEmailVerified()) {
            throw new IllegalArgumentException("WebSocket authentication required");
        }
        return user;
    }

    private void authorizeSubscribe(StompHeaderAccessor accessor) {
        authorizeDestination(accessor.getUser(), accessor.getDestination());
    }

    private void authorizeDestination(Principal principal, String destination) {
        if (!(principal instanceof UsernamePasswordAuthenticationToken auth)
                || !(auth.getPrincipal() instanceof UserEntity connectedUser)
                || !(auth.getDetails() instanceof java.util.Date expires) || !expires.after(new java.util.Date())) {
            throw new IllegalArgumentException("WebSocket authentication required");
        }
        UserEntity user = currentUser(connectedUser.getId());
        if (destination == null) {
            throw new IllegalArgumentException("Invalid subscription");
        }
        Matcher match = TOPIC.matcher(destination);
        if (!match.matches()) {
            throw new IllegalArgumentException("Invalid subscription");
        }
        String serviceId = match.group(2);
        ServiceEntity service = serviceRepository.findByIdWithProject(serviceId).orElse(null);
        if (service == null || service.getProject() == null) {
            throw new IllegalArgumentException("Invalid subscription");
        }
        if (user.getRole() == UserRole.ADMIN) {
            return;
        }
        if (!user.getId().equals(service.getProject().getOwnerId())) {
            throw new IllegalArgumentException("Invalid subscription");
        }
    }

    /** Recheck existing subscriptions as well: suspension, expiry and role changes take effect on delivery. */
    public Message<?> guardOutbound(Message<?> message) {
        SimpMessageHeaderAccessor accessor = SimpMessageHeaderAccessor.wrap(message);
        if (accessor.getMessageType() != SimpMessageType.MESSAGE) return message;
        // The simple broker copies the publisher's headers, not the subscriber's user: resolve it by session.
        Principal subscriber = accessor.getSessionId() != null ? sessions.get(accessor.getSessionId()) : null;
        try {
            authorizeDestination(subscriber, accessor.getDestination());
            return message;
        } catch (RuntimeException denied) {
            // Replace the event with an ERROR frame: Spring closes the WebSocket after sending one.
            if (accessor.getSessionId() != null) sessions.remove(accessor.getSessionId());
            StompHeaderAccessor error = StompHeaderAccessor.create(StompCommand.ERROR);
            error.setSessionId(accessor.getSessionId());
            error.setMessage("Session is no longer authorized");
            return org.springframework.messaging.support.MessageBuilder.createMessage(new byte[0], error.getMessageHeaders());
        }
    }

    /** Sessions currently holding a CONNECT authentication (for leak checks). */
    int connectedSessionCount() {
        return sessions.size();
    }

    private static String firstHeader(StompHeaderAccessor accessor, String name) {
        String value = accessor.getFirstNativeHeader(name);
        return value == null ? null : value.trim();
    }
}
