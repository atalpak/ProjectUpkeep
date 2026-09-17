Pod::Spec.new do |s|
  s.name = 'UpkeepVision'
  s.version = '0.1.0'
  s.summary = 'On-device card OCR and artwork comparison for Upkeep'
  s.description = s.summary
  s.license = { :type => 'Proprietary' }
  s.author = 'Project Upkeep'
  s.homepage = 'https://example.invalid/upkeep'
  s.platforms = { :ios => '15.1' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Vision', 'ImageIO', 'UIKit'
  s.swift_version = '5.9'
  s.source_files = '**/*.swift'
end
