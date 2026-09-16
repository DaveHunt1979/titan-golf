require 'xcodeproj'
project = Xcodeproj::Project.open('ios/titangolf.xcodeproj')

main_target = project.targets.find { |t| t.name == 'titangolf' }

['Embed Watch Content', 'Embed Foundation Extensions'].each do |phase_name|
  phase = main_target.build_phases.find { |bp| bp.respond_to?(:name) && bp.name == phase_name }
  puts "#{phase_name}: dst_subfolder_spec=#{phase.dst_subfolder_spec} dst_path=#{phase.dst_path.inspect}"
  phase.files.each { |f| puts "  file: #{f.file_ref&.path} (#{f.file_ref&.class})" }
end
