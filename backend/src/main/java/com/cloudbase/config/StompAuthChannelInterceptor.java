package com.cloudbase.config;

import com.cloudbase.entity.ServiceEntity;
import com.cloudbase.entity.UserEntity;
import com.cloudbase.model.UserRole;
import com.cloudbase.repository.ServiceRepository;
import com.cloudbase.repository.UserRepository;
import com.cloudbase.security.JwtService;
import io.jsonwebtoken.Claims;
import org.springframework.lang.NonNull;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
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
            accessor.setUser(auth);
            return message;
        }
        if (StompCommand.SUBSCRIBE.equals(accessor.getCommand())) {
            authorizeSubscribe(accessor);
        }
        return message;
    }

    private UserEntity authenticate(StompHeaderAccessor accessor) {
        String header = firstHeader(accessor, "Authorization");
        if (header == null || header.isBlank()) {
            header = firstHeader(accessor, "authorization");
        }
        String token = firstHeader(accessor, "token");
        if (header != null && header.startsWith("Bearer ")) {
            token = header.substring(7).trim();
        }
        if (token == null || token.isBlank() || !jwtService.isTokenValid(token)) {
            throw new IllegalArgumentException("WebSocket authentication required");
        }
        Claims claims = jwtService.parseToken(token);
        String purpose = claims.get("purpose", String.class);
        if (purpose != null && !purpose.isBlank()) {
            throw new IllegalArgumentException("WebSocket authentication required");
        }
        UserEntity user = userRepository.findById(claims.getSubject()).orElse(null);
        if (user == null) {
            throw new IllegalArgumentException("WebSocket authentication required");
        }
        return user;
    }

    private void authorizeSubscribe(StompHeaderAccessor accessor) {
        Principal principal = accessor.getUser();
        if (!(principal instanceof UsernamePasswordAuthenticationToken auth)
                || !(auth.getPrincipal() instanceof UserEntity user)) {
            throw new IllegalArgumentException("WebSocket authentication required");
        }
        String destination = accessor.getDestination();
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

    private static String firstHeader(StompHeaderAccessor accessor, String name) {
        String value = accessor.getFirstNativeHeader(name);
        return value == null ? null : value.trim();
    }
}
